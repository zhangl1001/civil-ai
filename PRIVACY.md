# Privacy Notice and Deployment Boundary

Last updated: 2026-08-09

This document describes the intended behavior of the open-source Civil AI client. It is not a privacy notice for every independently modified or hosted distribution. A distributor or service operator must publish its own accurate notice and complete any legal or regulatory assessment required for its deployment.

## Local-first storage

The project is designed without a maintainer-operated application backend. Learning records, imported materials, conversations, generated content, settings, and provider credentials are intended to remain in browser or device storage unless the user deliberately invokes an external capability.

Local-first does not mean that every operation is offline. Data leaves the device when a user chooses a model provider, web research source, speech service, or another external service. The destination's terms, privacy policy, retention rules, account controls, and network location apply independently.

## Data that may be processed

Depending on the features used, the client may process:

- learning plans, answers, scores, error records, and conversations;
- user-imported text, documents, photographs, and extracted text;
- microphone input or speech-recognition results;
- model prompts, responses, citations, and operational diagnostics;
- provider API keys and service configuration stored on the user's device.

Do not enter state secrets, work secrets, unreleased examination materials, another person's personal information, or content that you are not entitled to process. Voice recordings, identifiable photographs, identity documents, and information about children may require heightened protection and should not be processed without a specific need and a valid legal basis.

## External requests

Before enabling an external capability, a distribution should clearly identify the recipient, purpose, data categories, and expected consequences. It should obtain any consent required by applicable law, including separate consent where sensitive personal information is involved. The open-source project must not be represented as guaranteeing that a selected third-party provider is available or compliant in every jurisdiction.

Provider credentials must not be committed to Git, pasted into public issues, or included in diagnostic logs. Users should use restricted credentials where available and revoke a credential they suspect has been exposed.

## User control and deletion

Users can stop external processing by disabling the relevant provider or network capability. Local application data can be removed through available in-app deletion controls or by clearing the site's/app's local data. Removing local data does not automatically delete copies already sent to a third party; users must use that provider's controls or contact that provider.

A distributor must verify that its actual deletion, export, correction, consent-withdrawal, and complaint channels match its public notice before making the application available to users.

## AI-generated content

AI-generated or AI-organized text is fallible. A public-facing distribution must preserve clear AI-content identification in interactions and exports where applicable, and must not remove required visible or metadata labels. Users should verify current-affairs, policy, syllabus, answer, and scoring claims against authoritative sources.

## Maintainer and operator roles

Publishing source code is not the same as operating an online service. The repository maintainers do not receive user content or credentials merely because someone downloads the code. A person or organization that modifies, hosts, distributes, or commercially operates the software is responsible for the data flows and legal obligations created by that activity.

This document provides project boundaries, not legal advice.
