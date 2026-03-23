/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/ui/serverWidget", "N/runtime", "../MHI_Lodash_Lib.js"], (
  SEARCH,
  serverWidget,
  RUNTIME,
  _,
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
    const nexttab = RUNTIME.getCurrentScript().getParameter(
      "custscript_mhi_ecl_html_inputs_tabid",
    );
    const tabname = RUNTIME.getCurrentScript().getParameter(
      "custscript_mhi_ecl_html_cust_tabname",
    );

    form.clientScriptModulePath = "./MHI_ECL_CustomHtmlEntry_CS.js";
    const customer = rec.getValue("entity");

    const { results, groupedRec } = getFieldConfigs(recType);
    log.audit("Running HTML Config Search", results);

    // this map now should consider whether the field type is text-radio
    const indexes = results.map((ent, ind) => `.custom-radio-label-${ind}`);
    const tabIds = form.getTabs().map((tab) => tab);
    log.audit({
      title: "tab ids",
      details: tabIds,
    });

    let htmlStr = "";
    if (results.length > 0) {
      const form = context.form;

      const tabId = "custpage_mhi_ecl_html_tab";

      // Add custom tab
      const customtab = form.addTab({
        id: tabId,
        label: tabname || "KF - Sell Sheet",
      });
      form.insertTab({
        tab: customtab,
        nexttab,
      });

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
            align-items: center;
          }
        ${indexes.map(
          (res, ind) => `${res} {
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
      htmlStr = "<div style='width:100%;'>";
      const groups = Object.keys(groupedRec);
      const sortedGroups = _.sortBy(groups, (g) => groupedRec[g].seq);

      sortedGroups.forEach((group) => {
        // log.audit({
        //   title: group,
        //   details: { g: groupedRec[group] },
        // });
        const groupData = groupedRec[group];
        htmlStr += `<div style="width:50%; justify-content: center; margin:10px; border:1px solid #eee; border-radius:8px; padding:16px; ">`;

        htmlStr += `<div style="margin-bottom:4px;">`;
        if (groupData.title) {
          htmlStr += `<p style="font-weight:bold; font-size:16px;">${groupData.title}`;
          if (groupData.url) {
            htmlStr += `<a href="${groupData.url}" target="_blank" style="align-items:center;padding: 8px 4px 0px 4px;">`;
            htmlStr += `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="vertical-align:middle;">
              <circle cx="10" cy="10" r="9" stroke="#0070d2" stroke-width="2" fill="#eaf6ff"/>
              <polygon points="8,6 14,10 8,14" fill="#0070d2"/>
              </svg>
            </a></p>`;
          }
        } else {
          htmlStr += `<p style="font-weight:bold; font-size:16px; margin-bottom:4px;">Additional Information</p>`;
        }
        if (groupData.desc) {
          htmlStr += `<p style="font-size:13px; color:#666; margin-bottom:12px;">${groupData.desc}</p>`;
        }
        htmlStr += `</div>`;
        log.audit("groupData.fields", groupData.fields);
        const sortFields = _.sortBy(groupData.fields, (f) => f.seq);

        sortFields.forEach((result, ind) => {
          log.audit("Rendering Field", {
            data: result,
          });
          const { mainInput, radio, label, url, fieldtype, listSource } =
            result;
          htmlStr += `<div class="custom-radio-group">`;
          const textVal = rec.getValue(mainInput); // get the values from the record itself
          const radioVal = rec.getValue(radio); // get the values from the record itself

          const listOptions = listSource
            ? searchListOptions(listSource, customer)
            : [];
          // if (listSource) {
          //   const listOpSearch = SEARCH.create({
          //     type: listSource,
          //     columns: ["name"],
          //   });
          //   listOpSearch.run().each((res) => {
          //     listOptions.push({
          //       value: res.id,
          //       text: res.getValue("name"),
          //     });
          //     return true;
          //   });
          // }

          log.audit("Field Values", {
            mainInput,
            textVal,
            url,
          });

          const inputStr = generateCustomInput(
            type,
            label,
            url,
            fieldtype,
            mainInput,
            textVal,
            radio,
            radioVal,
            ind,
            listOptions.length > 0 ? listOptions : false,
          );
          htmlStr += inputStr;
          htmlStr += `</div>`;
        });

        // add a new field here.
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
          name: "custrecord_mhi_ecl_cust_html_field_type",
        }),
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_field_src",
        }),
        SEARCH.createColumn({ name: "custrecord_mhi_ecl_cust_html_seq" }),
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
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_grp_url",
          join: "custrecord_mhi_ecl_cust_html_group",
        }),
        SEARCH.createColumn({
          name: "custrecord_mhi_ecl_cust_html_grp_seq",
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
            seq: result.getValue({
              name: "custrecord_mhi_ecl_cust_html_grp_seq",
              join: "custrecord_mhi_ecl_cust_html_group",
            }),
            fields: [],
          };
        }
        groupedRec[group].fields.push({
          mainInput: result.getValue("custrecord_mhi_ecl_cust_html_text"),
          radio: result.getValue("custrecord_mhi_ecl_cust_html_radio"),
          label: result.getValue("custrecord_mhi_ecl_cust_html_label"),
          url: result.getValue("custrecord_mhi_ecl_cust_html_target"),
          fieldtype: result.getValue("custrecord_mhi_ecl_cust_html_field_type"),
          listSource: result.getValue("custrecord_mhi_ecl_cust_html_field_src"),
          seq: result.getValue("custrecord_mhi_ecl_cust_html_seq"),
        });
        results.push(result);
      }

      return true; // Only need the first result
    });
    return { results, groupedRec };
  };

  function generateCustomInput(
    contextType,
    label,
    url = false,
    fieldType,
    inputId,
    inputVal,
    radioId,
    radioVal,
    index,
    listOptions = false,
  ) {
    // log.audit("generateCustomInput", {
    //   label,
    //   url,
    // });
    let htmlStr = "";

    htmlStr += `<label style="font-size:14px; align-items:center; gap:4px;" for="custhtml_text">${label}</label>`;
    if (url) {
      htmlStr += `<a href="${url}" target="_blank" style="display:inline-flex; align-items:center;padding: 8px 4px 0px 4px;">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="vertical-align:middle;">
              <circle cx="10" cy="10" r="9" stroke="#0070d2" stroke-width="2" fill="#eaf6ff"/>
              <polygon points="8,6 14,10 8,14" fill="#0070d2"/>
              </svg>
            </a>`;
    }
    htmlStr += `<br/>`;

    const fixInputId = inputId.split("_").slice(1).join("_");
    if (fieldType == 1 || fieldType == 2) {
      htmlStr += `<input ${
        contextType === "view" ? "disabled" : ""
      } value="${inputVal}" type="text" id="custpage_${fixInputId}" 
              style="width:50%; border-radius:6px; margin-right:10px; padding:8px 8px; border:1px solid #ccc;" 
              onchange="(function(e) { debugger; console.log('changed the text input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${inputId}',document.querySelector('#custpage_${fixInputId}').value) }); })()"/>`;
    } else if (fieldType == 4) {
      const selectOptions =
        listOptions.length &&
        listOptions
          .map(
            (opt) =>
              `<option value="${opt.value}" ${opt.value == inputVal ? "selected" : ""}>${opt.text}</option>`,
          )
          .join("\n");
      htmlStr +=
        listOptions.length > 0 &&
        `<select style="width:30%; border-radius:6px; margin-right:10px; padding:8px 8px; border:1px solid #ccc;" ${contextType === "view" ? "disabled" : ""} id="custpage_${fixInputId}" onchange="(function(e) { debugger; console.log('changed the text input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${inputId}',document.querySelector('#custpage_${fixInputId}').value) }); })()"> <option value="">Select an Option</option>
            ${selectOptions}
          </select>`;
    } else if (fieldType == 5) {
      // convert the date format from the record into yyyy-mm-dd for the date input value
      let formattedDate = false;
      if (inputVal) {
        const inputDate = new Date(inputVal);
        formattedDate = inputDate
          ? `${inputDate.getFullYear()}-${inputDate.getMonth() + 1 < 10 ? "0" : ""}${inputDate.getMonth() + 1}-${inputDate.getDate() < 10 ? "0" : ""}${inputDate.getDate()}`
          : "";
      }
      htmlStr += `<input ${
        contextType === "view" ? "disabled" : ""
      } type="date" id="custpage_${fixInputId}" 
                value="${formattedDate || ""}" style="width:30%; border-radius:6px; margin-right:10px; padding:8px 8px; border:1px solid #ccc;" 
                onchange="(function(e) { debugger; console.log('changed the date input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); const setDate = document.querySelector('#custpage_${fixInputId}').value; const [yr, mo, day] = setDate.split('-'); debugger; curr.setValue('${inputId}', new Date(mo + '/' + day + '/' + yr)) }) })()"/>`;
      // }
    }

    const addRadio = [1, 2, 3, "1", "2", "3"];
    if (!!~addRadio.indexOf(fieldType) && radioId) {
      const fixRadioId = radioId.split("_").slice(1).join("_");
      htmlStr += `<label class="custom-radio-label-${index}">`;

      htmlStr += `<input type="radio" ${radioVal === "1" ? "checked" : ""} ${
        contextType === "view" ? "disabled" : ""
      } name="cust-radio-${index}" id="custpage_${fixRadioId}_flag" onchange="(function(e) { console.log('Setting Red Flag input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${radioId}','1') }); })()" />
                <span class="custom-radio-icon">
            <!-- Red flag SVG icon -->
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M4 2v16" stroke="#e74c3c" stroke-width="2"/>
              <path d="M4 3h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4" fill="#e74c3c" stroke="#e74c3c" stroke-width="1"/>
            </svg>
                </span>
              </label>
              <label class="custom-radio-label-${index}">
                <input type="radio" ${radioVal === "2" ? "checked" : ""} ${
                  contextType === "view" ? "disabled" : ""
                } name="cust-radio-${index}" id="custpage_${fixRadioId}_strength" onchange="(function(e) { console.log('Setting Strength input'); require(['N/currentRecord'], function(CR) { const curr = CR.get(); curr.setValue('${radioId}','2') }); })()" />
                <span class="custom-radio-icon">
            <!-- Strength (star) SVG icon -->
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <polygon points="10,2 12.59,7.36 18.51,8.09 14,12.26 15.18,18.09 10,15.27 4.82,18.09 6,12.26 1.49,8.09 7.41,7.36" fill="#f1c40f" stroke="#f1c40f" stroke-width="1"/>
            </svg>
                </span>
              </label>
          `;
    }

    return htmlStr;
  }

  const searchListOptions = (listSource, customer = false) => {
    const lowerCase = listSource.toLowerCase();
    const listOptions = [];
    if (lowerCase === "contacts" || lowerCase === "contact") {
      if (customer) {
        const contactSearch = SEARCH.create({
          type: "contact",
          filters: [
            ["type", "anyof", "CustJob"],
            "AND",
            ["company", "anyof", customer],
            "AND",
            ["isinactive", "is", "F"],
          ],
          columns: [SEARCH.createColumn({ name: "entityid", label: "Name" })],
        });
        contactSearch.run().each((res) => {
          listOptions.push({
            value: res.id,
            text: res.getValue("entityid"),
          });
          return true;
        });
      }
    } else if (lowerCase === "employees" || lowerCase === "employee") {
    } else {
      const listOpSearch = SEARCH.create({
        type: listSource,
        columns: ["name"],
      });
      listOpSearch.run().each((res) => {
        listOptions.push({
          value: res.id,
          text: res.getValue("name"),
        });
        return true;
      });
    }
    return listOptions;
  };

  return {
    beforeLoad,
  };
});
