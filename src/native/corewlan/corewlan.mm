/*
 * In-process CoreWLAN bridge for macOS.
 *
 * Why this exists rather than the `osascript` bridge it replaces:
 *
 * macOS gates every BSSID and country code behind a CoreLocation
 * authorization, and it resolves that authorization against the *requesting
 * process's own bundle identity*. It does not inherit from whichever app
 * spawned the process. Measured on macOS 26:
 *
 *   /usr/bin/osascript      bundle com.apple.osascript   authStatus 0  → SSIDs, no BSSIDs
 *   bare Mach-O helper      bundle <none>                authStatus 0  → nothing at all
 *
 * So a user who grants Clarity Location access in System Settings changes
 * nothing, because the process that actually asks CoreWLAN is not Clarity.
 * Loading CoreWLAN into the app's own main process is what makes the identity
 * `com.clarity.app` — the bundle that carries
 * NSLocationWhenInUseUsageDescription and that the user's grant applies to.
 *
 * The scan returns a JSON string rather than a built-up JS object graph. That
 * keeps the N-API surface to three tiny functions and lets the existing,
 * already-tested `parseCoreWlanOutput()` stay the single place that validates
 * the payload — the shape here is byte-compatible with what the JXA script
 * produced.
 */

#import <CoreLocation/CoreLocation.h>
#import <CoreWLAN/CoreWLAN.h>
#import <Foundation/Foundation.h>

#include <node_api.h>

#include <string>

// ─── JSON helpers ───────────────────────────────────────────
// Hand-rolled rather than NSJSONSerialization so a nil/NaN never turns into an
// exception mid-serialisation; every field funnels through one of these.

static void AppendEscaped(std::string &out, NSString *value) {
  if (value == nil) {
    out += "null";
    return;
  }
  out += '"';
  const char *utf8 = [value UTF8String];
  if (utf8 == NULL) {
    out += '"';
    return;
  }
  for (const char *p = utf8; *p; ++p) {
    unsigned char c = (unsigned char)*p;
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += (char)c;
        }
    }
  }
  out += '"';
}

/** A finite number, or `null`. Guards NaN/inf, which are not valid JSON. */
static void AppendNumber(std::string &out, double value, bool present) {
  if (!present || !isfinite(value)) {
    out += "null";
    return;
  }
  char buf[32];
  snprintf(buf, sizeof(buf), "%.10g", value);
  out += buf;
}

static void AppendBool(std::string &out, BOOL value) {
  out += value ? "true" : "false";
}

// ─── CoreWLAN → JSON ────────────────────────────────────────

/** `channelNumber` / `channelBand` / `channelWidth` for a channel, or nulls. */
static void AppendChannel(std::string &out, CWChannel *channel) {
  if (channel == nil) {
    out += "\"channel\":null,\"bandCode\":null,\"widthCode\":null";
    return;
  }
  out += "\"channel\":";
  AppendNumber(out, (double)[channel channelNumber], true);
  out += ",\"bandCode\":";
  AppendNumber(out, (double)[channel channelBand], true);
  out += ",\"widthCode\":";
  AppendNumber(out, (double)[channel channelWidth], true);
}

/**
 * `-[CWNetwork supportsSecurity:]` answers yes for every suite the AP is
 * compatible with, so the JS side collapses the list to one label. Probing the
 * same 0..15 range the JXA script did keeps that logic unchanged.
 */
static void AppendSecurityCodes(std::string &out, CWNetwork *network) {
  out += '[';
  bool first = true;
  for (int code = 0; code <= 15; ++code) {
    BOOL supported = NO;
    @try {
      supported = [network supportsSecurity:(CWSecurity)code];
    } @catch (NSException *e) {
      supported = NO;
    }
    if (!supported) continue;
    if (!first) out += ',';
    out += std::to_string(code);
    first = false;
  }
  out += ']';
}

static void AppendPhyCodes(std::string &out, CWNetwork *network) {
  out += '[';
  bool first = true;
  for (int code = 1; code <= 6; ++code) {
    BOOL supported = NO;
    @try {
      supported = [network supportsPHYMode:(CWPHYMode)code];
    } @catch (NSException *e) {
      supported = NO;
    }
    if (!supported) continue;
    if (!first) out += ',';
    out += std::to_string(code);
    first = false;
  }
  out += ']';
}

/**
 * Run the scan and serialise it.
 *
 * `active` sweeps the radio (~3s, interrupts traffic); otherwise the driver's
 * cached neighbour list is read, which is what makes the 3-second live signal
 * poll affordable. Runs on a worker thread — see the async wrapper below.
 */
static std::string RunScan(bool active) {
  std::string out;
  out.reserve(16 * 1024);
  out += '{';

  @autoreleasepool {
    CWWiFiClient *client = [CWWiFiClient sharedWiFiClient];
    CWInterface *iface = client == nil ? nil : [client interface];

    if (iface == nil) {
      out += "\"ok\":false,\"interfaceName\":null,\"powerOn\":false,\"active\":false,";
      out += "\"current\":null,\"networks\":[],\"error\":\"no-wifi-interface\"}";
      return out;
    }

    BOOL powerOn = NO;
    @try {
      powerOn = [iface powerOn];
    } @catch (NSException *e) {
      powerOn = NO;
    }

    out += "\"interfaceName\":";
    AppendEscaped(out, [iface interfaceName]);
    out += ",\"powerOn\":";
    AppendBool(out, powerOn);

    // ── current connection ──
    out += ",\"current\":{";
    out += "\"ssid\":";
    AppendEscaped(out, [iface ssid]);
    out += ",\"bssid\":";
    AppendEscaped(out, [iface bssid]);
    out += ",\"rssi\":";
    AppendNumber(out, (double)[iface rssiValue], true);
    out += ",\"noise\":";
    AppendNumber(out, (double)[iface noiseMeasurement], true);
    out += ",\"txRate\":";
    AppendNumber(out, [iface transmitRate], true);
    out += ",\"securityCode\":";
    AppendNumber(out, (double)[iface security], true);
    out += ",\"phyCode\":";
    AppendNumber(out, (double)[iface activePHYMode], true);
    out += ",\"countryCode\":";
    AppendEscaped(out, [iface countryCode]);
    out += ',';
    AppendChannel(out, [iface wlanChannel]);
    out += ",\"mode\":";
    AppendNumber(out, (double)[iface interfaceMode], true);
    out += '}';

    // ── neighbour list ──
    NSSet<CWNetwork *> *networks = nil;
    BOOL didActive = NO;
    if (active) {
      NSError *error = nil;
      @try {
        networks = [iface scanForNetworksWithSSID:nil error:&error];
        didActive = (networks != nil);
      } @catch (NSException *e) {
        networks = nil;
      }
    }
    if (networks == nil) {
      didActive = NO;
      @try {
        networks = [iface cachedScanResults];
      } @catch (NSException *e) {
        networks = nil;
      }
    }

    out += ",\"active\":";
    AppendBool(out, didActive);
    out += ",\"networks\":[";
    bool firstNet = true;
    if (networks != nil) {
      for (CWNetwork *network in networks) {
        if (network == nil) continue;
        if (!firstNet) out += ',';
        firstNet = false;
        out += '{';
        out += "\"ssid\":";
        AppendEscaped(out, [network ssid]);
        out += ",\"bssid\":";
        AppendEscaped(out, [network bssid]);
        out += ",\"rssi\":";
        AppendNumber(out, (double)[network rssiValue], true);
        out += ",\"noise\":";
        AppendNumber(out, (double)[network noiseMeasurement], true);
        out += ',';
        AppendChannel(out, [network wlanChannel]);
        out += ",\"countryCode\":";
        AppendEscaped(out, [network countryCode]);
        out += ",\"beaconInterval\":";
        AppendNumber(out, (double)[network beaconInterval], true);
        out += ",\"ibss\":";
        AppendBool(out, [network ibss]);
        out += ",\"securityCodes\":";
        AppendSecurityCodes(out, network);
        out += ",\"phyCodes\":";
        AppendPhyCodes(out, network);
        out += '}';
      }
    }
    out += "],\"error\":null,\"ok\":true}";
  }

  return out;
}

// ─── async scan ─────────────────────────────────────────────
// CoreWLAN's active sweep blocks for seconds. Running it on the JS thread
// would freeze the window, so it goes through napi_async_work and resolves a
// promise.

struct ScanTask {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  bool active = false;
  std::string result;
};

static void ScanExecute(napi_env, void *data) {
  ScanTask *task = static_cast<ScanTask *>(data);
  task->result = RunScan(task->active);
}

static void ScanComplete(napi_env env, napi_status status, void *data) {
  ScanTask *task = static_cast<ScanTask *>(data);
  napi_value out = nullptr;

  if (status == napi_ok &&
      napi_create_string_utf8(env, task->result.c_str(), NAPI_AUTO_LENGTH, &out) == napi_ok) {
    napi_resolve_deferred(env, task->deferred, out);
  } else {
    napi_value message = nullptr;
    napi_create_string_utf8(env, "corewlan-scan-failed", NAPI_AUTO_LENGTH, &message);
    napi_value error = nullptr;
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, task->deferred, error);
  }

  napi_delete_async_work(env, task->work);
  delete task;
}

static napi_value ScanJson(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  bool active = false;
  if (argc >= 1) {
    napi_value coerced = nullptr;
    if (napi_coerce_to_bool(env, argv[0], &coerced) == napi_ok) {
      napi_get_value_bool(env, coerced, &active);
    }
  }

  napi_value promise = nullptr;
  ScanTask *task = new ScanTask();
  task->active = active;
  if (napi_create_promise(env, &task->deferred, &promise) != napi_ok) {
    delete task;
    return nullptr;
  }

  napi_value name = nullptr;
  napi_create_string_utf8(env, "clarity_corewlan_scan", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ScanExecute, ScanComplete, task, &task->work) != napi_ok) {
    delete task;
    return nullptr;
  }
  napi_queue_async_work(env, task->work);
  return promise;
}

// ─── CoreLocation authorization ─────────────────────────────

/**
 * A manager kept alive for the process lifetime.
 *
 * `requestWhenInUseAuthorization` is a no-op on a deallocated manager, and the
 * status change arrives on the delegate/run loop afterwards — so a manager
 * created and dropped inside one call would never see the prompt through.
 */
static CLLocationManager *SharedLocationManager() {
  static CLLocationManager *manager = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    manager = [[CLLocationManager alloc] init];
  });
  return manager;
}

/** Raw CLAuthorizationStatus: 0 notDetermined, 2 denied, 3 always, 4 whenInUse. */
static napi_value LocationAuthStatus(napi_env env, napi_callback_info) {
  int32_t status = 0;
  @autoreleasepool {
    CLLocationManager *manager = SharedLocationManager();
    status = manager == nil ? 0 : (int32_t)[manager authorizationStatus];
  }
  napi_value out = nullptr;
  napi_create_int32(env, status, &out);
  return out;
}

static napi_value LocationServicesEnabled(napi_env env, napi_callback_info) {
  BOOL enabled = NO;
  @autoreleasepool {
    enabled = [CLLocationManager locationServicesEnabled];
  }
  napi_value out = nullptr;
  napi_get_boolean(env, enabled ? true : false, &out);
  return out;
}

/**
 * Raise the system Location prompt for this bundle.
 *
 * Must run on the main thread — CoreLocation silently ignores the request
 * otherwise, which is the failure mode where a user clicks "Grant access" and
 * no dialog ever appears. Electron's main process owns the main run loop, so
 * dispatching there is both correct and already pumped.
 */
static napi_value RequestLocationAuthorization(napi_env env, napi_callback_info) {
  dispatch_async(dispatch_get_main_queue(), ^{
    @autoreleasepool {
      CLLocationManager *manager = SharedLocationManager();
      if (manager == nil) return;
      if ([manager respondsToSelector:@selector(requestWhenInUseAuthorization)]) {
        [manager requestWhenInUseAuthorization];
      }
    }
  });
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

// ─── module init ────────────────────────────────────────────

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"scanJson", nullptr, ScanJson, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"locationAuthStatus", nullptr, LocationAuthStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"locationServicesEnabled", nullptr, LocationServicesEnabled, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"requestLocationAuthorization", nullptr, RequestLocationAuthorization, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
