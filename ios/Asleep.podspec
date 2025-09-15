Pod::Spec.new do |s|
  s.name           = 'Asleep'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '14', :tvos => '14' }
  s.source         = { git: 'https://github.com/asleep-ai/asleep-sdk-react-native' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'AsleepSDK', '3.1.6'


  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
