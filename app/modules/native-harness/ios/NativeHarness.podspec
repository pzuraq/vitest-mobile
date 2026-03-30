Pod::Spec.new do |s|
  s.name           = 'NativeHarness'
  s.version        = '0.1.0'
  s.summary        = 'Native view query and touch synthesis for RN test harness'
  s.homepage       = 'https://github.com/test'
  s.license        = 'MIT'
  s.author         = 'Test'
  s.source         = { git: '' }
  s.platform       = :ios, '16.0'
  s.swift_version  = '5.9'

  # Our module + vendored Hammer sources
  s.source_files   = '**/*.{swift,h,m}'
  s.exclude_files  = 'Hammer/Info.plist'

  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'UIKit', 'CoreGraphics', 'IOKit'
end
