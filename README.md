# Abe's Personal SDF Utility Repository

This repository will be your starting point for SuiteScript projects, and contains some helpful utilities if you need them. You can clone this repository to start, and rename it before continuing dev for your project. I also created this so I could create branches for projects where SDF was not already in use, or for maintaining one-off scripts that might not exist in a project's git already. NOTE: only create PRs for base level features, and do not merge client-specific feature branches. Your local branches should be where those client-specific scripts live (also on the remote, but not merged)

## Contents

- .eslintrc
- .prettierrc
- .gitignore
- project.json
- suitecloud.config.js
- src
  - AccountConfiguration
  - File Cabinet
    - Templates
      - Email Templates
      - Marketing Templates
    - SuiteScripts
      - Myers-Holum
        - Client-Scripts
        - MHI_Utility_Lib_Plugin.js
    - Objects
  - Translations
  - deploy.xml
  - manifest.xml

## SuiteScript 2.1

SuiteScript 2.1 is now mandatory for all new projects. To make your script 2.1, change the JSDoc tag to 2.1:

```
/**
 * @NApiVersion 2.1
 * @NScriptType plugintypeimpl
 */
```

For additional documentation, please review [SuiteAnswers](https://netsuite.custhelp.com/app/answers/detail/a_id/86967)

## SuiteCloud Development Framework

- Overview
  https://suiteanswers.custhelp.com/app/answers/detail/a_id/51622
- SuiteCloud Extension for Visual Studio

  https://suiteanswers.custhelp.com/app/answers/detail/a_id/101375

  Install Visual Studio extension following instruction from this link
  https://suiteanswers.custhelp.com/app/answers/detail/a_id/101370

- SuiteCloud IDE plugin for Webstorm
  https://suiteanswers.custhelp.com/app/answers/detail/a_id/79464
