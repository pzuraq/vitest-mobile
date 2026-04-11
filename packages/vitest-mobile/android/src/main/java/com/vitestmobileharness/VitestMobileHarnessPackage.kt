package com.vitestmobileharness

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class VitestMobileHarnessPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == VitestMobileHarnessModule.NAME) {
      VitestMobileHarnessModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        VitestMobileHarnessModule.NAME to ReactModuleInfo(
          VitestMobileHarnessModule.NAME,
          VitestMobileHarnessModule.NAME,
          false,
          false,
          false,
          true,
        )
      )
    }
  }
}
