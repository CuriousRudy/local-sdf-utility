# MHI | Abe R - Custom SDF Repository

InternalInternal utility SDF repository. Used for one-off deployments

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

Customizations:

### Custom HTML Fields

<ol>
	<li>Customization that displays custom, interactable HTML fields on NS UI forms. A custom Configuration record defines the field setup, including the ids of the NS custom fields that store the entered values for auditing/reporting. When the form loads, the script adds custom fields to the form and groups them appropriately.
	</li>
	<li>Each record type that gets fields needs:
		<ol>
			<li>Custom [recordtypecustomfield] for each input type needed related to a category. For example, for the field: Timing on the Customer record, there may be a text input and a radio input. A custom enttity field should be created for the text, and one for the radio (list/record)</li>
			<li>Custom HTML config record. This includes the label, possible path for Korn Ferry integration. Internal ids of the custom fields created. This custom record should be customized to include additional fiel types besides text and radio. Groups custom record/list groups related fields in the UI.</li>
			<li>Script Deployment for each discrete record type. In this case, if there are no other fields added on the Customer, a new Deployment is created. There is a script parameter that is used on the deployment, the internal Integer internalid for the record type. This is used to find the record type field on the HTML config. see list below
			<ol>
				<li> Account: `-112`</li>
				<li> Accounting Period: `-105`</li>
				<li> Bin: `-242`</li>
				<li> Call: `-22`</li>
				<li> Campaign: `-24`</li>
				<li>Case: `-23`</li>
				<li>Class: `-101`</li>
				<li>Competitor: `-108`</li>
				<li>Contact: `-6`</li>
				<li>Customer: `-2`</li>
				<li>Customer Category: `-109`</li>
				<li>Department: `-102`</li>
				<li>Email Template: `-120`</li>
				<li>Employee: `-4`</li>
				<li>Employee Type: `-111`</li>
				<li>Entity Status: `-104`</li>
				<li>Event: `-20`</li>
				<li>Issue: `-26`</li>
				<li>Item: `-10`</li>
				<li>Item Type: `-106`</li>
				<li>Job (Project): `-7`</li>
				<li>Location: `-103`</li>
				<li>Module: `-116`</li>
				<li>Opportunity: `-31`</li>
				<li>Partner: `-5`</li>
				<li>Product: `-115`</li>
				<li>Product Build: `-114`</li>
				<li>Product Version: `-113`</li>
				<li>Project (Job): `-7`</li>
				<li>Role: `-118`</li>
				<li>Saved Search: `-119`</li>
				<li>Subsidiary: `-117`</li>
				<li>Task: `-21`</li>
				<li>Transaction: `-30`</li>
				<li>Transaction Type: `-100`</li>
				<li>Vendor: `-3`</li>
				<li>Vendor Category: `-110`</li>
    		</ol>
    		</li>
    	</ol>
    </li>

</ol>
