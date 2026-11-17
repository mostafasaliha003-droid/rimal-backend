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
${END}`;

function applyLocalNinja(contents, language) {
  if (language !== 'groovy') throw new Error('The local Ninja plugin requires the Expo Groovy project build.gradle template.');
  const previous = /\n?\/\/ @generated begin mkhadda-local-ninja[\s\S]*?\/\/ @generated end mkhadda-local-ninja\n?/g;
  return `${contents.replace(previous, '').trimEnd()}\n\n${BLOCK}\n`;
}

function withLocalNinja(config) {
  return withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = applyLocalNinja(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
}

module.exports = withLocalNinja;
module.exports.applyLocalNinja = applyLocalNinja;
