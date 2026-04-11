require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name           = "VitestMobileHarness"
  s.version        = package["version"]
  s.summary        = "Native view query and touch synthesis for vitest-mobile"
  s.homepage       = "https://github.com/test"
  s.license        = "MIT"
  s.author         = "Test"
  s.source         = { git: "" }

  s.platforms      = { :ios => "16.0" }
  s.source_files   = "ios/*.{h,m,mm,cpp}"
  s.frameworks     = "IOKit"

  install_modules_dependencies(s)
end
