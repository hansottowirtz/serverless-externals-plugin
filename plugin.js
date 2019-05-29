'use strict';

const path = require('path');
const remoteLs = require('npm-remote-ls');
const util = require('util');

class ExternalsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'before:package:createDeploymentArtifacts': this.addExcludes.bind(this)
    };
  }

  async addExcludes() {
    const service = this.serverless.service;
    
    service.package = service.package || {};
    service.package.exclude = service.package.exclude || [];
    service.package.include = service.package.include || [];

    let externalsFile;
    let externals = [];

    const settings = service.custom && service.custom.externals ? service.custom.externals : {};

    if (typeof settings === 'object' && settings.constructor === Array) {
      externals = externals.concat(settings);
    } else if (settings.modules) {
      externals = externals.concat(settings.modules);
    }

    externalsFile = settings.file || externalsFile;
    const exclude = settings.exclude || [];

    const allExternals = await ExternalsPlugin.externals(this.serverless.config.servicePath, externals, {exclude});

    allExternals.forEach(external => {
      const subpath = settings.moduleSubpaths && settings.moduleSubpaths[external] ? settings.moduleSubpaths[external] : '**';
      if (settings.useInclude) {
        service.package.include.push(`./node_modules/${external}/${subpath}`);
      } else {
        service.package.exclude.push(`!./node_modules/${external}/${subpath}`);
      }
    });
  }
}

ExternalsPlugin.externals = async function(root, externals, config) {
  config = config || {};
  const externalsFilePath = config.externalsFilePath || path.join(root, 'node-externals.json');
  const packagePath = config.packagePath || path.join(root, 'package.json');

  externals = externals || [];
  try {
    externals = externals.concat(require(externalsFilePath));
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  if (config.exclude) {
    console.log('Not including in package:', config.exclude.join(', '));
    externals = externals.filter(external => config.exclude.indexOf(external) < 0);
  }

  console.log('Listed externals:', externals.join(', '));

  const pkg = require(packagePath);
 
  if (!externals || (!externals.length && !config.exclude)) throw new Error('No externals listed');
  debugger;

  let allExternals = [].concat(externals);

  const promises = [];

  console.log(`Fetching dependencies for ${externals.length} modules...`);

  remoteLs.config(config.ls || {
    development: false,
    optional: false,
    peer: false
  });

  const ls = util.promisify((name, version, flatten, cb) => remoteLs.ls(name, version, flatten, (result) => cb(null, result)));

  externals.forEach(external => {
    const version = pkg.dependencies[external];

    if (!version) {
      throw new Error('External module ' + external + ' not listed in package.json dependencies');
    }

    promises.push(ls(external, version, true));
  });

  const dependenciesArray = await Promise.all(promises);

  console.log(`Fetching done`);

  dependenciesArray.forEach(array => {
    allExternals = allExternals.concat(array.map(s => s.split('@')[0]));
  });

  allExternals = allExternals.filter((v, i, a) => a.indexOf(v) === i); // Unique

  console.log('Externals with dependencies (these modules will be included in the package):', allExternals.join(', '));

  return allExternals;
}

ExternalsPlugin.externalsWebpack = function(root, externals, config) {
  const promise = ExternalsPlugin.externals(root, externals, config);

  return (context, query, callback) => {
    promise.then(array => {
      const found = !!array.find(name => name === query || query.startsWith(`${name}/`));
      found ? callback(null, `commonjs ${query}`) : callback();
    });
    promise.catch(err => {
      console.warn('Error retrieving externals', err);
      callback(`Error retrieving externals: ${err}`);
    });
  }
}

ExternalsPlugin.externalsRollup = async function(root, externals, config) {
  const array = await ExternalsPlugin.externals(root, externals, config);
  return query => !!array.find(name => name === query || query.startsWith(`${name}/`));
}

module.exports = ExternalsPlugin;
