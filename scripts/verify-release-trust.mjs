#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = new Set(['macos', 'windows', 'linux']);
const REQUIRED_SMOKE_CHECKS = [
  'install',
  'open',
  'openApprovedMarkdown',
  'editSaveReopen',
  'externalChangeHandled',
];

function fail(message) {
  process.stderr.write(`release-trust: ${message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

function requiredEnvironment(names) {
  return names.filter((name) => !process.env[name]?.trim());
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    fail(`cannot read evidence ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateSmokeEvidence(evidence, target) {
  if (evidence?.schema !== 'simplemark.platform-smoke.v1') {
    fail('smoke evidence must use schema simplemark.platform-smoke.v1');
    return false;
  }
  if (evidence.target !== target) {
    fail(`smoke evidence target must be ${target}`);
    return false;
  }
  if (!/^[0-9a-f]{40}$/i.test(evidence.commit ?? '')) {
    fail('smoke evidence must record the exact 40-character commit SHA');
    return false;
  }
  if (!evidence.artifact?.name || !/^[0-9a-f]{64}$/i.test(evidence.artifact?.sha256 ?? '')) {
    fail('smoke evidence must record an artifact name and SHA-256');
    return false;
  }
  const validExtension = target === 'macos'
    ? evidence.artifact.name.endsWith('.dmg')
    : target === 'windows'
      ? /\.(msi|exe)$/i.test(evidence.artifact.name)
      : evidence.artifact.name.endsWith('.AppImage');
  if (!validExtension) {
    fail(`smoke evidence artifact is not the expected ${target} installer type`);
    return false;
  }
  const missing = REQUIRED_SMOKE_CHECKS.filter((check) => evidence.checks?.[check] !== true);
  if (missing.length) {
    fail(`smoke evidence is incomplete: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

function validatePlatformTrust(evidence, target) {
  const required = target === 'macos'
    ? ['codeSigned', 'notarized', 'stapled']
    : target === 'windows'
      ? ['codeSigned', 'signatureVerified']
      : [];
  const missing = required.filter((check) => evidence.trust?.[check] !== true);
  if (missing.length) {
    fail(`platform trust evidence is incomplete: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

function signingRequirements(target) {
  if (target === 'macos') {
    return [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_SIGNING_IDENTITY',
      'APPLE_ID',
      'APPLE_PASSWORD',
      'APPLE_TEAM_ID',
      'KEYCHAIN_PASSWORD',
    ];
  }
  if (target === 'windows') {
    return [
      'SIMPLEMARK_WINDOWS_CERTIFICATE',
      'SIMPLEMARK_WINDOWS_CERTIFICATE_PASSWORD',
      'SIMPLEMARK_WINDOWS_TIMESTAMP_URL',
    ];
  }
  return [];
}

const target = option('--target');
const evidencePath = option('--evidence');
const mode = option('--mode') || 'public-release';

if (!TARGETS.has(target)) {
  fail('pass --target macos, windows, or linux');
} else if (mode !== 'public-release') {
  fail('only --mode public-release is supported');
} else if (!evidencePath) {
  fail('pass --evidence <platform-smoke.json>');
} else {
  const evidence = readJson(evidencePath);
  const smokeIsValid = evidence && validateSmokeEvidence(evidence, target);
  const trustIsValid = smokeIsValid && validatePlatformTrust(evidence, target);
  const missingSecrets = requiredEnvironment(signingRequirements(target));
  if (missingSecrets.length) {
    fail(`required signing environment is absent: ${missingSecrets.join(', ')}`);
  }
  if (trustIsValid && !missingSecrets.length) {
    process.stdout.write(`release-trust: ${target} public-release gate passed for ${evidence.artifact.name}\n`);
  }
}
