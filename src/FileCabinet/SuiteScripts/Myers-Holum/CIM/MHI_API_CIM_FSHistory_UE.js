/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
  "N/search",
  "./MHI_API_CIM_Functions.js",
  "./MHI_API_CIM_Variables.js",
] /**
 * @param{runtime} runtime
 * @param{message} message
 */, (SEARCH, FUNCS, VAR) => {
  /**
   * Defines the function definition that is executed before record is loaded.
   * @param {Object} context
   * @param {Record} context.newRecord - New record
   * @param {string} context.type - Trigger type; use values from the context.UserEventType enum
   * @param {Form} context.form - Current form
   * @param {ServletRequest} context.request - HTTP request information sent from the browser for a client action only.
   * @since 2015.2
   */

  const VARS = VAR.getVars();

  function beforeSubmit(context) {
    const { newRecord, type } = context;
    if (
      type !== context.UserEventType.CREATE &&
      type !== context.UserEventType.EDIT
    )
      return;

    const parentFs = newRecord.getValue({
      fieldId: VARS.FSH_PARENT_FS,
    });

    if (parentFs) {
      const lookupFsRec = SEARCH.lookupFields({
        type: VARS.FS_RECORDID,
        id: parentFs,
        columns: [VARS.FS_CIMPARENT],
      });
      const parentCim = lookupFsRec[VARS.FS_CIMPARENT][0].value;
      if (parentCim) {
        const lookupCustomer = lookupCustomerFromCim(parentCim);

        const teamMembers = FUNCS.getSalesTeamMembers(lookupCustomer);
        log.audit("BEFORESUBMIT : teamMembers", teamMembers);
        if (teamMembers.length)
          newRecord.setValue(VARS.FSH_SALES_TEAM, teamMembers);
      }
    }
  }

  function lookupCustomerFromCim(cimId) {
    const lookupCimRec = SEARCH.lookupFields({
      type: VARS.CIM_RECORDID,
      id: cimId,
      columns: [VARS.CIM_CUSTOMER],
    });
    return lookupCimRec[VARS.CIM_CUSTOMER][0].value;
  }

  return { beforeSubmit };
});
