import { RuleConfigSeverity } from '@commitlint/types';

const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Types allowed — conventional set plus a few project additions
    'type-enum': [
      RuleConfigSeverity.Error,
      'always',
      [
        'feat', // new feature → minor bump
        'fix', // bug fix → patch bump
        'perf', // performance improvement → patch bump
        'refactor', // code change that neither fixes a bug nor adds a feature → patch
        'chore', // tooling, deps, config → patch
        'docs', // documentation only → patch
        'style', // formatting, whitespace (no logic change) → patch
        'test', // adding or correcting tests → patch
        'build', // build system or external dependency changes → patch
        'ci', // CI/CD configuration → patch
        'revert', // reverts a previous commit
      ],
    ],

    // Scope is optional but must be lowercase if provided
    'scope-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],

    // Subject rules
    'subject-empty': [RuleConfigSeverity.Error, 'never'],
    'subject-full-stop': [RuleConfigSeverity.Error, 'never', '.'],
    // Allow any case in subject (sentence-case is fine, so is lower)
    'subject-case': [RuleConfigSeverity.Disabled],

    // Header length
    'header-max-length': [RuleConfigSeverity.Error, 'always', 100],

    // Body / footer
    'body-leading-blank': [RuleConfigSeverity.Warning, 'always'],
    'footer-leading-blank': [RuleConfigSeverity.Warning, 'always'],
  },
};

export default config;
