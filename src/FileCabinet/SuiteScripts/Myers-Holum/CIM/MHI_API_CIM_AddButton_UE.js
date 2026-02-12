/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define(["N/search", "N/record"], function (SEARCH, RECORD) {
  function beforeLoad(context) {
    // add a button to the form when in view mode
    const { form, type } = context;

    if (type === context.UserEventType.VIEW) {
      form.clientScriptModulePath = "./MHI_API_CIM_AddButton_CS.js";
      form.addButton({
        id: "custpage_create_cim",
        label: "CIM Entry",
        functionName: "launchCimRecord",
      });
    }
  }

  function beforeSubmit(context) {
    const { oldRecord, newRecord, type } = context;
    if (type !== context.UserEventType.EDIT) return;

    const oldTeamCount = oldRecord.getLineCount("salesteam");
    const oldTeamMembers = [];
    for (let i = 0; i < oldTeamCount; i++) {
      oldTeamMembers.push(
        oldRecord.getSublistValue({
          sublistId: "salesteam",
          fieldId: "employee",
          line: i,
        }),
      );
    }
    const newTeamCount = newRecord.getLineCount("salesteam");
    const newTeamMembers = [];
    for (let i = 0; i < newTeamCount; i++) {
      newTeamMembers.push(
        newRecord.getSublistValue({
          sublistId: "salesteam",
          fieldId: "employee",
          line: i,
        }),
      );
    }

    let hasChanges = false;

    // Compare line counts
    if (oldTeamCount !== newTeamCount) {
      hasChanges = true;
    } else {
      oldTeamMembers.forEach((member) => {
        if (!~newTeamMembers.indexOf(member)) {
          hasChanges = true;
        }
      });
      // Compare each line
      if (!hasChanges)
        newTeamMembers.forEach((member) => {
          if (!~oldTeamMembers.indexOf(member)) {
            hasChanges = true;
          }
        });
    }

    if (hasChanges) {
      newRecord.setValue("custentity_mhi_api_cim_update_sales_team", true);
    }
  }

  function afterSubmit(context) {}

  return {
    beforeLoad,
    beforeSubmit,
    afterSubmit,
  };
});
