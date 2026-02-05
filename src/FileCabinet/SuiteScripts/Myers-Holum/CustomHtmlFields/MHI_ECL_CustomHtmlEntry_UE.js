/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/ui/serverWidget", "N/runtime"], (
  SEARCH,
  serverWidget,
  RUNTIME,
) => {
  function beforeLoad(context) {
    const { type } = context;
    if (
      // context.type !== context.UserEventType.VIEW &&
      type !== context.UserEventType.EDIT &&
      type !== context.UserEventType.VIEW
    )
      return;

    const rec = context.newRecord;
    const form = context.form;
    const recType = rec.type;

    form.clientScriptModulePath = "./MHI_ECL_CustomHtmlEntry_CS.js";

    const { results, groupedRec } = getFieldConfigs(recType);
    log.audit("Running HTML Config Search", results);

    const indexes = results.map((ent, ind) => `.custom-radio-label-${ind}`);

    let htmlStr = "";
    if (results.length > 0) {
      const form = context.form;

      const tabId = "custpage_mhi_ecl_html_tab";

      // Add custom tab
      const customtab = form.addTab({
        id: tabId,
        label: "MHI | KF Custom Fields",
      });
      // form.insertTab({
      //   tab: customtab,
      //   nexttab: 'support'
      // });

      // Add HTML field to the custom field group
      // form.addFieldGroup({
      //   id: "custpage_mhi_ecl_html_group",
      //   label: "Custom HTML Fields",
      // });

      form.addField({
        id: "custpage_mhi_ecl_html_field",
        type: serverWidget.FieldType.INLINEHTML,
        label: "Custom HTML",
        container: tabId,
      });

      log.audit("indexes", indexes);
      htmlStr += `
        <style>
          .custom-radio-group {
            display: flex;
            align-items: center;
          }
        ${indexes.map(
          (res, ind) => `${res} { display: flex;
            align-items: center;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            padding: 4px 8px;
            border-radius: 6px;
            transition: background 0.2s; }`,
        )}

          ${indexes.map((res, ind) => `${res} input[type="radio"] { display: none; }`).join("\n")}
            
          .custom-radio-icon {
            width: 20px;
            height: 20px;
            margin-right: 6px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
            
          ${indexes
            .map(
              (res, ind) =>
                `${res} input[type="radio"]:checked + .custom-radio-icon {  filter: drop-shadow(0 0 2px #0070d2) ; }`,
            )
            .join("\n")}
          ${indexes
            .map(
              (res, ind) =>
                `${res} iinput[type="radio"]:checked ~ span {  color: #0070d2; }`,
            )
            .join("\n")}
            
          }
            ${indexes.map((res, ind) => `${res}:hover { background: #f0f4fa; }`)}
        </style>`;
      htmlStr = "<div style='display:flex; width:100%;'>";
      const groups = Object.keys(groupedRec);
      groups.forEach((group) => {
        log.audit({
          title: group,
          details: { g: groupedRec[group] },
        });
        const groupData = groupedRec[group];
        htmlStr += `<div style="width:100%; flex:1; margin:10px; border:1px solid #eee; border-radius:8px; padding:16px; ">`;

        htmlStr += `<div style="margin-bottom:4px;">`;
        if (groupData.title) {
          htmlStr += `<p style="font-weight:bold; font-size:16px;">${groupData.title}`;
          if (groupData.url)
            htmlStr += `<a href="${groupData.url}" target="_blank" style="display:inline-flex;align-items:center;padding: 8px 4px 0px 4px;">`;
          htmlStr += `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="vertical-align:middle;">
              <circle cx="10" cy="10" r="9" stroke="#0070d2" stroke-width="2" fill="#eaf6ff"/>
              <polygon points="8,6 14,10 8,14" fill="#0070d2"/>
              </svg>
            </a></p>`;
        } else {
          htmlStr += `<p style="font-weight:bold; font-size:16px; margin-bottom:4px;">Additional Information</p>`;
        }
        if (groupData.desc) {
          htmlStr += `<p style="font-size:13px; color:#666; margin-bottom:12px;">${groupData.desc}</p>`;
        }
        htmlStr += `</div>`;
        log.audit("groupData.fields", groupData.fields);

        groupData.fields.forEach((result, ind) => {
          htmlStr += `<div class="custom-radio-group">`;
          const text = result.getValue("custrecord_mhi_ecl_cust_html_text");
          const radio = result.getValue("custrecord_mhi_ecl_cust_html_radio");
          const label = result.getValue("custrecord_mhi_ecl_cust_html_label");
          const url = result.getValue("custrecord_mhi_ecl_cust_html_target");
          const textVal = rec.getValue(text);
          const radioVal = rec.getValue(radio);
          log.audit("Field Values", {
            text,
            textVal,
            radio,
            radioVal,
          });
          const htmlText =
            result.getValue("custrecord_mhi_ecl_cust_html_text") || "";

          // htmlStr += `<div style="margin-bottom:10px;">`;

          htmlStr += `<label style="font-size:14px; align-items:center;gap:4px;" for="custhtml_text">${label}</label>`;
          if (url) {
            htmlStr += `<a href="${url}" target="_blank" style="display:inline-flex;align-items:center;padding: 8px 4px 0px 4px;">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="vertical-align:middle;">
              <circle cx="10" cy="10" r="9" stroke="#0070d2" stroke-width="2" fill="#eaf6ff"/>
              <polygon points="8,6 14,10 8,14" fill="#0070d2"/>
              </svg>
            </a>`;
          }
          htmlStr += `<br/>`;
          htmlStr += `<input ${
            type === context.UserEventType.VIEW ? "disabled" : ""
          } value="${textVal}" type="text" id="custpage_${text.split("_").slice(1).join("_")}" 
            style="width:30%; border-radius:6px; margin-right:10px; padding:4px 8px; border:1px solid #ccc;" 
            onchange="(function(e) { debugger; console.log('changed the text input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${text}',document.querySelector('#custpage_${text
              .split("_")
              .slice(1)
              .join("_")}').value) }); })()"/>`;
          if (radio)
            htmlStr += `<label class="custom-radio-label-${ind}">
                <input type="radio" ${radioVal === "1" ? "checked" : ""} ${
                  type === context.UserEventType.VIEW ? "disabled" : ""
                } name="cust-radio-${ind}" id="custpage_${radio
                  .split("_")
                  .slice(1)
                  .join(
                    "_",
                  )}_flag" onchange="(function(e) { console.log('Setting Red Flag input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${radio}','1') }); })()" />
                <span class="custom-radio-icon">
            <!-- Red flag SVG icon -->
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M4 2v16" stroke="#e74c3c" stroke-width="2"/>
              <path d="M4 3h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4" fill="#e74c3c" stroke="#e74c3c" stroke-width="1"/>
            </svg>
                </span>
              </label>
              <label class="custom-radio-label-${ind}">
                <input type="radio" ${radioVal === "2" ? "checked" : ""} ${
                  type === context.UserEventType.VIEW ? "disabled" : ""
                } name="cust-radio-${ind}" id="custpage_${radio
                  .split("_")
                  .slice(1)
                  .join(
                    "_",
                  )}_strength" onchange="(function(e) { console.log('Setting Strength input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${radio}','2') }); })()" />
                <span class="custom-radio-icon">
            <!-- Strength (star) SVG icon -->
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <polygon points="10,2 12.59,7.36 18.51,8.09 14,12.26 15.18,18.09 10,15.27 4.82,18.09 6,12.26 1.49,8.09 7.41,7.36" fill="#f1c40f" stroke="#f1c40f" stroke-width="1"/>
            </svg>
                </span>
              </label>
          `;
          htmlStr += `</div>`;
        });
        htmlStr += `</div>`;
      });

      htmlStr += "</div>";
    }
    form.getField({ id: "custpage_mhi_ecl_html_field" }).defaultValue = htmlStr;
  }

  const getFieldConfigs = (recType) => {
    const recTypeId = RUNTIME.getCurrentScript().getParameter(
      "custscript_mhi_ecl_crt_rec_type",
    );
    log.audit("recTypeId Param", recTypeId);
    const results = [];
    const groupedRec = {};
    const htmlConfigSearch = SEARCH.create({
      type: "customrecord_mhi_ecl_cust_html_config",
      filters: [["custrecord_mhi_ecl_cust_html_type", "anyof", recTypeId]],
      columns: [
        SEARCH.createColumn({ name: "internalid" }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_text" }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_radio" }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_target" }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_label" }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_group" }),
        SEARCH.createColumn({
          name: "name",
          join: "custrecord_mhi_ecl_cust_html_group",
        }),
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_grp_title",
          join: "custrecord_mhi_ecl_cust_html_group",
        }),
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_grp_desc",
          join: "custrecord_mhi_ecl_cust_html_group",
        }),
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_grp_url",
          join: "custrecord_mhi_ecl_cust_html_group",
        }),
      ],
    });

    htmlConfigSearch.run().each((result) => {
      const group =
        result.getText("custrecord_mhi_ecl_cust_html_group") || "MISC";
      if (group) {
        if (!groupedRec[group]) {
          groupedRec[group] = {
            title: result.getValue({
              name: "custrecord_mhi_ecl_cust_html_grp_title",
              join: "custrecord_mhi_ecl_cust_html_group",
            }),
            desc: result.getValue({
              name: "custrecord_mhi_ecl_cust_html_grp_desc",
              join: "custrecord_mhi_ecl_cust_html_group",
            }),
            url: result.getValue({
              name: "custrecord_mhi_ecl_cust_html_grp_url",
              join: "custrecord_mhi_ecl_cust_html_group",
            }),
            fields: [],
          };
        }
        groupedRec[group].fields.push(result);
        results.push(result);
      }
      return true; // Only need the first result
    });
    return { results, groupedRec };
  };

  function getCustomRecordTypeValue2(name) {
    //leverage NetSuite's URL generator to get the record type
    return getURLParameterByName("rectype", nlapiResolveURL("RECORD", name));

    //url parser helper function
    function getURLParameterByName(name, url) {
      log.audit("getURLParameterByName", { name, url });
      name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
      var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(url);
      return results === null ? "" : results[1].replace(/\+/g, " ");
    }
  }

  function getCustomRecordTypeValue(name) {
    let url = require(["N/url"]);
    url = require("N/url");
    //leverage NetSuite's URL generator to get the record type
    return getURLParameterByName(
      "rectype",
      url.resolveRecord({
        isEditMode: false,
        recordType: name,
        // recordId: 1
      }),
    );

    //url parser helper function
    function getURLParameterByName(name, url) {
      log.audit("getURLParameterByName", { name, url });
      name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
      var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(url);
      return results === null ? "" : results[1].replace(/\+/g, " ");
    }
  }

  return {
    beforeLoad,
  };
});
