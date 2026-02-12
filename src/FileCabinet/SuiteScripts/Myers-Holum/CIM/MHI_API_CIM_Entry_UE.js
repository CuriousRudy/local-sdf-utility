/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define([
  "./MHI_API_CIM_Variables.js",
  "./MHI_API_CIM_Functions.js",
  "N/search",
  "N/record",
  "N/url",
  "N/redirect",
  "N/runtime",
], function (VAR, FUNCS, SEARCH, RECORD, URL, REDIRECT, RUNTIME) {
  const VARS = VAR.getVars();
  function beforeLoad(context) {
    const { form, type, newRecord } = context;

    if (type === context.UserEventType.CREATE) {
      const parameters = context.request.parameters;

      if (parameters) {
        // log.audit("parameters", parameters);
        newRecord.setValue(VARS.CIM_FCSALESMETHOD, "");
        FUNCS.checkParamsForHeaderFields(newRecord, parameters);
      }
    } else {
      FUNCS.checkForDuplicateCimBanner(newRecord, "cim", form);

      const unitsType = newRecord.getValue({
        fieldId: VARS.CIM_UNITTYPE,
      });

      if (unitsType) {
        const unitSearch = SEARCH.create({
          type: "unitstype",
          filters: [
            SEARCH.createFilter({
              name: "internalid",
              operator: SEARCH.Operator.ANYOF,
              values: unitsType,
            }),
          ],
        });
        let unitTypeId = false;
        unitSearch.run().each((result) => {
          log.audit("unitSearchResult", JSON.stringify(result));
          unitTypeId = result.id;
          return true;
        });
        if (unitTypeId) {
          log.audit("unitTypeId", unitTypeId);

          const unitTypeRecord = RECORD.load({
            type: "unitstype",
            id: unitTypeId,
          });

          const uomSublistId = "uom";
          const uomCount = unitTypeRecord.getLineCount({
            sublistId: uomSublistId,
          });

          const customField = form.addField({
            id: VARS.CIM_CUSTUOMSEL,
            type: "select",
            label: "Custom UoM List",
          });
          customField.addSelectOption({
            value: "-1",
            text: "",
          });

          form.insertField({
            field: customField,
            isBefore: true,
            nextfield: "custrecord_mhi_resaleuom",
          });
          // const customField = form.addField({
          //   id: "custpage_uom_select",
          //   type: "select",
          //   label: "Units of Measure",
          // });

          for (let i = 0; i < uomCount; i++) {
            const uomName = unitTypeRecord.getSublistValue({
              sublistId: uomSublistId,
              fieldId: "abbreviation",
              line: i,
            });

            const uomId = unitTypeRecord.getSublistValue({
              sublistId: uomSublistId,
              fieldId: "internalid",
              line: i,
            });

            customField.addSelectOption({
              value: uomId,
              text: uomName,
            });
          }
        }
      }
    }
  }

  function beforeSubmit(context) {
    log.audit("BEFORESUBMIT : context", context);
    const { type, newRecord } = context;
    if (type === context.UserEventType.CREATE) {
      const customer = newRecord.getValue({ fieldId: VARS.CIM_CUSTOMER });
      const item = newRecord.getValue({ fieldId: VARS.CIM_ITEM });

      if (customer && item) {
        FUNCS.setNameField(newRecord);

        const itemFields = FUNCS.getItemFieldValues(item);
        log.audit("itemFields", itemFields);
        FUNCS.setValuesIfEmpty(newRecord, item, itemFields);

        const vendorcode = itemFields[0].getValue("vendorcode");
        const unitsType = itemFields[0].getValue("unitstype");
        if (vendorcode) {
          const itemPrice = FUNCS.getCustomerItemPrice(customer, vendorcode);
          log.audit("itemPrice", itemPrice);
          if (itemPrice) {
            newRecord.setValue({
              fieldId: VARS.CIM_CUSTPRICE,
              value: itemPrice,
            });
          }
        }

        if (unitsType) {
          newRecord.setValue({
            fieldId: VARS.CIM_UNITTYPE,
            value: unitsType,
          });
        }

        setSalesTeam(customer, newRecord);
      }
    } else if (type === context.UserEventType.EDIT) {
      const customer = newRecord.getValue({ fieldId: VARS.CIM_CUSTOMER });
      if (customer) setSalesTeam(customer, newRecord);
    } else return;
  }

  function afterSubmit(context) {
    const { type, newRecord } = context;
    if (
      type !== context.UserEventType.CREATE &&
      type !== context.UserEventType.EDIT
    )
      return;
    // forecast Sales should happen in aftersubmit
    const inventoryLocation = newRecord.getValue(VARS.CIM_INVLOC);
    log.audit("inventoryLocation", inventoryLocation);

    if (inventoryLocation) {
      try {
        const forecastRec = FUNCS.createForecastRecord(newRecord);
        log.audit("forecastRec", forecastRec);
      } catch (e) {
        log.error("error", e);
      }
    }

    // first check for other matching forecast sales history record.
    // if unique, get all the fields from the subtab and set them on the forecast sales rec.
  }

  function setSalesTeam(customerId, recOb) {
    const teamMembers = FUNCS.getSalesTeamMembers(customerId);
    log.audit("AFTERSUBMIT : teamMembers", teamMembers);
    if (teamMembers.length)
      recOb.setValue({
        fieldId: VARS.CIM_SALES_TEAM,
        value: teamMembers,
      });
  }

  return {
    beforeLoad,
    beforeSubmit,
    afterSubmit,
  };
});
