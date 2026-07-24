#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const generatedConfigPath = path.join(root, 'ios/App/App/capacitor.config.json');
const packagePath = path.join(root, 'ios/App/CapApp-SPM/Package.swift');
const packageJsonPath = path.join(root, 'package.json');

function fail(message) {
  console.error(`verify-capacitor-ios: ${message}`);
  process.exit(1);
}

function read(file) {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`);
  return fs.readFileSync(file, 'utf8');
}

let generatedConfig;
try {
  generatedConfig = JSON.parse(read(generatedConfigPath));
} catch (error) {
  fail(`invalid generated capacitor.config.json: ${error.message}`);
}

const packageClasses = generatedConfig.packageClassList;
if (!Array.isArray(packageClasses)) fail('generated config is missing packageClassList');
for (const plugin of ['CapacitorSQLitePlugin', 'StatusBarPlugin']) {
  if (!packageClasses.includes(plugin)) fail(`generated config is missing ${plugin}`);
}

const swiftPackage = read(packagePath);
if (!swiftPackage.includes('.product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite")')) {
  fail('CapApp-SPM is missing CapacitorCommunitySqlite product');
}

const packageJson = JSON.parse(read(packageJsonPath));
if (!packageJson.dependencies?.['@capacitor-community/sqlite']) {
  fail('package.json is missing @capacitor-community/sqlite');
}

console.log('Capacitor iOS plugins verified: SQLite, StatusBar');
