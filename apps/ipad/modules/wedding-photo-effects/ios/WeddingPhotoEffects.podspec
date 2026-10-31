Pod::Spec.new do |s|
  s.name = 'WeddingPhotoEffects'
  s.version = '1.0.0'
  s.summary = 'Local Core Image postcapture renderer'
  s.description = 'Versioned sRGB recipes with immutable camera originals.'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.author = 'Xare123'
  s.homepage = 'https://github.com/Xare123/WeddingIpadPhotoboothApp'
  s.platforms = { :ios => '16.0' }
  s.swift_version = '5.0'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'WeddingFrameArt' => ['FrameArt/*.frameart'] }
  s.frameworks = 'CoreImage', 'CoreText', 'ImageIO', 'UniformTypeIdentifiers', 'CryptoKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
