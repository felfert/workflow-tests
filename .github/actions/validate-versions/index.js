const core = require('@actions/core');
const github = require('@actions/github');
const glob = require('@actions/glob');
const toml = require('@iarna/toml');
const fs = require('fs');

function validateSemver(version) {
    const re = new RegExp("(0|[1-9]\d*)+\.(0|[1-9]\d*)+\.(0|[1-9]\d*)+(-(([a-z-][\da-z-]+|[\da-z-]+[a-z-][\da-z-]*|0|[1-9]\d*)(\.([a-z-][\da-z-]+|[\da-z-]+[a-z-][\da-z-]*|0|[1-9]\d*))*))?(\\+([\da-z-]+(\.[\da-z-]+)*))?$");
    if (re.exec(version) == null) {
        core.setFailed(`Invalid version ${version}`);
    }
}

function readVersion(file) {
    try {
        const fields = ['package', 'version'];
        var str = fs.readFileSync(file);
        var parsed = toml.parse(str);
        var value = parsed;
        fields.forEach(function (f) {
            value = value[f];
        });
        return value;
    } catch (error) {
        core.setFailed(error.message);
    }
}

// githubs's glob toolkit has a bug (or unexpected behavior):
// If a pattern doe NOT contain any special glob chars, it gets removed COMPLETELY from
// the result. This is not what a unix shell user would expect. E.g: If running in a
// directory containing a single file index.js the following:
//
//     echo *.js foo.js
//
// would print:
//
//    index.js foo.js
//
// With this package's current implementation, foo.js would be removed from the result.
//
// Workaround: Before creating the globber, we filter out the "non-globbing" elements
// and put them in a separate array whitch gets added verbatim after apply globbing
// to the patterns that actually need globbing.
//
async function globIfNecessary(patterns, follow) {
    const re = /(^~)|([*?[\]])/g;
    var result = [];
    const verbatim  = [];
    const toglob = [];
    patterns.forEach(function (p) {
        if (p.match(re)) {
            toglob.push(p);
        } else {
            verbatim.push(p);
        }
    });
    if (toglob.length > 0) {
        const globber = await glob.create(toglob.join('\n'), {
            followSymbolicLinks: follow,
            implicitDescendants: false,
            matchDirectories: false,
            omitBrokenSymbolicLinks: false
        });
        result = await globber.glob();
    }
    return result.concat(verbatim);
}

async function main() {
  const follow = core.getInput('followSymlinks');
  var version = core.getInput('refname');
  const reftype = core.getInput('reftype');
  const patterns = core.getMultilineInput('tomls');
  // If refname is 'branch', then the first toml is taken as a reference.
  // Therefore we sort by path length, so that the toplevel toml comes first.
  const tomls = (await globIfNecessary(patterns, follow)).sort((a, b) => a.split(/[/\\]/).length - b.split(/[/\\]/).length);

  if (reftype == 'tag') {
      console.log(`Validating version ${version} from tag`);
      validateSemver(version);
  } else {
      if (tomls.length > 0) {
          const f = tomls[0];
          const tmp = readVersion(f);
          if (typeof tmp == 'string') {
              version = tmp;
              console.log(`Validating version ${version} in ${f}`);
              validateSemver(version);
              console.log(`Version ${version} taken as reference for further comparisons`)
          } else {
              core.setFailed(`Version in ${f} is not a string`);
          }
          tomls.shift();
      }
  }
  tomls.forEach(function(f) {
      console.log(`Validating ${f}`);
      const tversion = readVersion(f);
      if (typeof tversion != 'undefined') {
        // If version is a object and has a boolean member 'workspace' set to true
        // and the file is not in the toplevel dir
        if (typeof tversion  == 'object') {
            if (Object.hasOwn(tversion, 'workspace')) {
                if (tversion['workspace'] == true) {
                    if (f.split(/[/\\]/).length > 1) {
                        console.log(`Version in ${f} refers to toplevel version`);
                        return;
                    }
                }
            }
            core.setFailed(`Version in ${f} is not a string`);
        }
        console.log(`Validating version ${tversion} in ${f}`);
        validateSemver(tversion);
        if (tversion != version) {
            core.setFailed(`Version ${tversion} in ${f} is different than ${version}`);
        }
      }
  });
}

try {
    main();
} catch (error) {
  core.setFailed(error.message);
}
