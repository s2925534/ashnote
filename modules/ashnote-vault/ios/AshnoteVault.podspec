Pod::Spec.new do |s|
  s.name           = 'AshnoteVault'
  s.version        = '1.0.0'
  s.summary        = "Keeps Ashnote's database key behind the phone's own owner check."
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'VelosoLabs'
  s.homepage       = 'https://velosolabs.com/ashnote'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
