Pod::Spec.new do |s|
  s.name = 'LernPrivacy'
  s.version = '1.0.0'
  s.summary = 'Local app-switcher privacy cover and sleep-inclusive clock'
  s.author = 'Lern'
  s.homepage = 'https://github.com/BunhourLong/Lern'
  s.license = { :type => 'Private' }
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.static_framework = true
  s.source_files = '*.swift'
  s.dependency 'ExpoModulesCore'
end
