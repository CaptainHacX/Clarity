{
  "targets": [
    {
      "target_name": "clarity_corewlan",
      "conditions": [
        ["OS==\"mac\"", {
          "sources": ["corewlan.mm"],
          "libraries": [
            "-framework CoreWLAN",
            "-framework CoreLocation",
            "-framework Foundation"
          ],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": ["-fobjc-arc"]
          }
        }, {
          # Windows and Linux have no CoreWLAN. Building nothing here is
          # deliberate: `npm install` must succeed on those platforms, and the
          # JS loader treats a missing binary as "no native scanner" and uses
          # the nmcli / netsh paths, which return BSSIDs without any
          # permission gate.
          "type": "none"
        }]
      ]
    }
  ]
}
