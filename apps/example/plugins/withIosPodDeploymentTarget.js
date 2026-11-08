/**
 * withIosPodDeploymentTarget — raises every Pod target to the app's iOS deployment target.
 *
 * ## Why
 *
 * Xcode 27 refuses targets below iOS 15.0, and several pods still declare older ones in their
 * podspecs (SDWebImage 9.0, GoogleSignIn 12.0, RNSVG 12.4, ...). The archive then fails with:
 *
 *     The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 9.0, but the range of
 *     supported deployment target versions is 15.0 to 27.1.x.
 *
 * `ios/` is gitignored under CNG, so editing the Pods project or the Podfile by hand lasts only
 * until the next prebuild. The app never runs below `ios.deploymentTarget`, so raising a pod to
 * it costs nothing. A pod that already targets something newer keeps its own value.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARKER = '# withIosPodDeploymentTarget';

const HOOK = `    ${MARKER}
    minimum_target = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '15.1')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next if current && Gem::Version.new(current) >= minimum_target
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_target.to_s
      end
    end

`;

const withIosPodDeploymentTarget = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const podfile = fs.readFileSync(podfilePath, 'utf8');
      if (podfile.includes(MARKER)) return cfg;

      const anchor = 'post_install do |installer|\n';
      if (!podfile.includes(anchor)) {
        throw new Error('[withIosPodDeploymentTarget] no post_install block found in the Podfile');
      }
      fs.writeFileSync(podfilePath, podfile.replace(anchor, `${anchor}${HOOK}`));
      return cfg;
    },
  ]);

module.exports = withIosPodDeploymentTarget;
