'use strict';

const { withProjectBuildGradle } = require('expo/config-plugins');

const START = '// @generated begin mkhadda-local-ninja';
const END = '// @generated end mkhadda-local-ninja';
const BLOCK = String.raw`${START}
// Local preview only. The environment guard leaves normal builds unchanged.
def mkhaddaLocalNinja = System.getenv('MKHADDA_LOCAL_NINJA')?.trim()
if (mkhaddaLocalNinja) {
    def mkhaddaNinjaFile = new File(mkhaddaLocalNinja)
    if (!mkhaddaNinjaFile.isAbsolute() || !mkhaddaNinjaFile.isFile()) {
        throw new GradleException('MKHADDA_LOCAL_NINJA must identify an existing absolute executable path.')
    }
    def mkhaddaNinjaPath = mkhaddaNinjaFile.canonicalPath.replace(File.separatorChar, '/' as char)
    allprojects { mkhaddaProject ->
        ['com.android.application', 'com.android.library'].each { mkhaddaAndroidPlugin ->
            mkhaddaProject.plugins.withId(mkhaddaAndroidPlugin) {
                def mkhaddaAndroid = mkhaddaProject.extensions.getByName('android')
                mkhaddaAndroid.defaultConfig.externalNativeBuild.cmake.arguments.add('-DCMAKE_MAKE_PROGRAM=' + mkhaddaNinjaPath)
            }
        }
    }
}

// Optional controlled diagnostic. No staging-directory override is active by default.
def mkhaddaNativeStagingRoot = System.getenv('MKHADDA_NATIVE_STAGING_ROOT')?.trim()
if (mkhaddaNativeStagingRoot) {
    def mkhaddaStagingRoot = new File(mkhaddaNativeStagingRoot)
    if (!mkhaddaStagingRoot.isAbsolute() || (mkhaddaStagingRoot.exists() && !mkhaddaStagingRoot.isDirectory())) {
        throw new GradleException('MKHADDA_NATIVE_STAGING_ROOT must identify an absolute directory path.')
    }
    def mkhaddaCanonicalStagingRoot = mkhaddaStagingRoot.canonicalFile
    allprojects { mkhaddaProject ->
        ['com.android.application', 'com.android.library'].each { mkhaddaAndroidPlugin ->
            mkhaddaProject.plugins.withId(mkhaddaAndroidPlugin) {
                def mkhaddaAndroid = mkhaddaProject.extensions.getByName('android')
                def mkhaddaModuleKey = java.security.MessageDigest.getInstance('SHA-256').digest(mkhaddaProject.path.getBytes('UTF-8')).encodeHex().toString().take(12)
                mkhaddaAndroid.externalNativeBuild.cmake.buildStagingDirectory = new File(mkhaddaCanonicalStagingRoot, mkhaddaModuleKey)
            }
        }
    }
}
${END}`;

function applyLocalNinja(contents, language) {
  if (language !== 'groovy') throw new Error('The local Ninja plugin requires the Expo Groovy project build.gradle template.');
  const previous = /\n?\/\/ @generated begin mkhadda-local-ninja[\s\S]*?\/\/ @generated end mkhadda-local-ninja\n?/g;
  const clean = contents.replace(previous, '');
  if (clean.includes(START) || clean.includes(END)) throw new Error('Malformed local Ninja generated-block markers in the project build.gradle.');
  const expo = [...clean.matchAll(/^[\t ]*apply[\t ]+plugin:[\t ]*(['"])expo-root-project\1[\t ]*;?[\t ]*\r?$/gm)];
  const react = [...clean.matchAll(/^[\t ]*apply[\t ]+plugin:[\t ]*(['"])com\.facebook\.react\.rootproject\1[\t ]*;?[\t ]*\r?$/gm)];
  const firstApply = clean.match(/^[\t ]*apply[\t ]+plugin:/m);
  if (expo.length !== 1 || react.length !== 1 || expo[0].index >= react[0].index || firstApply?.index !== expo[0].index) {
    throw new Error('Unexpected Expo project build.gradle template: require one expo-root-project application before com.facebook.react.rootproject, with no earlier plugin application.');
  }
  // React's root plugin can evaluate Android children immediately. Register all
  // callbacks before either root plugin runs, while native DSL values are mutable.
  return `${clean.slice(0, expo[0].index).trimEnd()}\n\n${BLOCK}\n\n${clean.slice(expo[0].index).trimEnd()}\n`;
}

function withLocalNinja(config) {
  return withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = applyLocalNinja(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
}

module.exports = withLocalNinja;
module.exports.applyLocalNinja = applyLocalNinja;
