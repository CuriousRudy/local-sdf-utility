/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define([
  "N/search",
  "N/record",
  "./MHI_API_CIM_Variables.js",
  "./MHI_API_CIM_Functions.js",
], (SEARCH, RECORD, VAR, FUNC) => {
  const VARS = VAR.getVars();
  /**
   * Gets the input data for the map reduce script
   * @returns {Array} Array of records to process
   */
  const getInputData = () => {
    const customerIds = getCustomerIds();

    const membersByCustomer = FUNC.getSalesTeamMembers(customerIds, true);
    log.debug("membersByCustomer", membersByCustomer);

    const cimRecIds = buildDataset(customerIds, membersByCustomer);

    log.debug("cimRecIds", cimRecIds);
    return cimRecIds;
  };

  /**
   * Maps the input data
   * @param {Object} context - Map context
   * @param {string} context.key - Key of the current item
   * @param {Object} context.value - Value of the current item
   */
  const map = (context) => {
    // Map logic here
    const { key, value } = context;

    const { type, id, customer, salesteam } = JSON.parse(value);
    log.debug("mapping record", { type, id, salesteam });
    const updatedId = RECORD.submitFields({
      type,
      id,
      values: {
        [VARS.CIM_SALESTEAM_MAP[type]]: salesteam,
      },
    });

    return context.write({
      key: customer,
      value: { ...JSON.parse(value), updatedId },
    });

    return true;
  };

  /**
   * Reduces the mapped data
   * @param {Object} context - Reduce context
   * @param {string} context.key - Key of the current item
   * @param {Array} context.values - Array of values for the key
   */
  const reduce = (context) => {
    // Reduce logic here
    const { key, values } = context;
    log.debug("reducing record", { key, values });

    let updateCustomer = true;
    values.forEach((value) => {
      const { id, updatedId } = JSON.parse(value);
      if (id != updatedId) updateCustomer = false;
    });
    if (updateCustomer) {
      RECORD.submitFields({
        type: "customer",
        id: key,
        values: {
          custentity_mhi_api_cim_update_sales_team: false,
        },
      });
    }
  };

  /**
   * Summarizes the results
   * @param {Object} summary - Summary context
   */
  const summarize = (summary) => {
    // Summarize logic here
  };

  const getResults = () => {
    const pageRanges = toRun.runPaged({
      pageSize: 1000,
    }).pageRanges;

    pageRanges.forEach((range) => {
      const page = toRun
        .runPaged({
          pageSize: 1000,
        })
        .fetch({ index: range.index });

      page.data.forEach((result) => {});
    });
  };

  const getCustomerIds = () => {
    const customerIds = [];
    const customerSearch = SEARCH.create({
      type: "customer",
      filters: [["custentity_mhi_api_cim_update_sales_team", "is", true]],
    });
    customerSearch.run().each((result) => {
      customerIds.push(result.id);
      return true;
    });
    return customerIds;
  };

  const buildDataset = (customerIds, membersByCustomer) => {
    const cimRecIds = [];
    const fsParents = [];
    const fshParents = [];

    const cimRecSearch = SEARCH.create({
      type: VARS.CIM_RECORDID,
      filters: [[VARS.CIM_CUSTOMER, "anyof", customerIds]],
      columns: [
        SEARCH.createColumn({
          name: VARS.CIM_CUSTOMER,
        }),
        SEARCH.createColumn({
          name: VARS.CIM_SALES_TEAM,
        }),
      ],
    });

    const pageRanges = cimRecSearch.runPaged({
      pageSize: 1000,
    }).pageRanges;

    pageRanges.forEach((range) => {
      const page = cimRecSearch
        .runPaged({
          pageSize: 1000,
        })
        .fetch({ index: range.index });

      page.data.forEach((result) => {
        const customerid = result.getValue({ name: VARS.CIM_CUSTOMER });
        fsParents.push(result.id);
        cimRecIds.push({
          type: VARS.CIM_RECORDID,
          id: result.id,
          customer: customerid,
          salesteam: membersByCustomer[customerid] || [],
        });
      });
    });

    const fsSearch = SEARCH.create({
      type: VARS.FS_RECORDID,
      filters: [[VARS.FS_CIMPARENT, "anyof", fsParents]],
      columns: [
        SEARCH.createColumn({
          name: VARS.FS_CIM_CUSTOMER,
        }),
      ],
    });
    fsSearch.run().each((result) => {
      fshParents.push(result.id);
      cimRecIds.push({
        type: VARS.FS_RECORDID,
        id: result.id,
        customer: result.getValue({ name: VARS.FS_CIM_CUSTOMER }),
        salesteam:
          membersByCustomer[result.getValue({ name: VARS.FS_CIM_CUSTOMER })] ||
          [],
      });
      return true;
    });

    const fshSearch = SEARCH.create({
      type: VARS.FSH_RECORDID,
      filters: [[VARS.FSH_PARENT_FS, "anyof", fshParents]],
      columns: [
        SEARCH.createColumn({
          name: VARS.FS_CIM_CUSTOMER,
          join: VARS.FSH_PARENT_FS,
        }),
      ],
    });
    fshSearch.run().each((result) => {
      const fsCustomer = result.getValue({
        name: VARS.FS_CIM_CUSTOMER,
        join: VARS.FSH_PARENT_FS,
      });

      cimRecIds.push({
        type: VARS.FSH_RECORDID,
        id: result.id,
        customer: fsCustomer,
        salesteam: membersByCustomer[fsCustomer] || [],
      });
      return true;
    });

    return cimRecIds;
  };

  return {
    getInputData,
    map,
    reduce,
    summarize,
  };
});
