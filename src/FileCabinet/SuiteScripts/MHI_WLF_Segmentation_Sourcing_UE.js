/* eslint-disable no-param-reassign */
/* eslint-disable max-len */
/* Script intent is to do the following:
- Auto sourcing segmentation fields on the line level of the journal entry and item records
 */
/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
 */
define(["N/record", "N/search", "N/runtime"], (record, search, runtime) => {
  const matterObj = {};
  const headerFieldObj = {
    department: "department",
    location: "location",
  };
  const lineFieldObj = {
    department: "department",
    location: "location",
    principalAttorney: "cseg_mhi_attorney",
    practiceArea: "class",
    clientName: "cseg_mhi_clients",
    // clientName: "custcol_mhi_wlf_client_name",
    matterName: "custcolmhi_matter_name",
  };
  /**
   * Handles logic before submitting a record.
   *
   * @param {Object} context - The context object containing information about the record and the event type.
   */
  function beforeSubmit(context) {
    try {
      const IS_CREATE = context.type === "create";
      const IS_EDIT = context.type === "edit";

      if (!IS_CREATE && !IS_EDIT) return;
      const currentRec = context.newRecord;
      //Abe R. 1/30/26 - removed by request of Sharon, pursuant to NS Support Case 6759948
      // const isVoid = currentRec.getValue("void");
      // if (isVoid) return;

      const sublistId =
        currentRec.type == "journalentry" ||
        currentRec.type == "advintercompanyjournalentry"
          ? "line"
          : "expense";
      getMatterInfo(currentRec, sublistId);

      log.debug("matterObj", matterObj);

      setHeaderMatterFields(currentRec);
      setLineMatterFields(currentRec, sublistId);

      setLineMatterFields(currentRec, "item");
    } catch (e) {
      log.error("Error", e);
    }
  }

  function setHeaderMatterFields(currentRec) {
    const headerMatterId = currentRec.getValue("cseg_mhi_matters");

    if (!headerMatterId) return;
    for (const propertyName in headerFieldObj) {
      const fieldId = headerFieldObj[propertyName];
      const fieldValue = matterObj[headerMatterId]
        ? matterObj[headerMatterId][propertyName]
        : "" || "";
      currentRec.setValue(fieldId, fieldValue);
    }
  }

  function setLineMatterFields(currentRec, sublistId) {
    const lineCount = currentRec.getLineCount(sublistId);
    const headerMatterId = currentRec.getValue("cseg_mhi_matters");

    for (let i = 0; i < lineCount; i += 1) {
      const lineMatterId = currentRec.getSublistValue(
        sublistId,
        "cseg_mhi_matters",
        i,
      );
      const matterId = headerMatterId || lineMatterId;
      if (!matterId) continue;

      for (const propertyName in lineFieldObj) {
        const fieldId = lineFieldObj[propertyName];
        const fieldValue = matterObj[matterId]
          ? matterObj[matterId][propertyName]
          : "" || "";
        currentRec.setSublistValue(sublistId, fieldId, i, fieldValue);
      }

      currentRec.setSublistValue(sublistId, "cseg_mhi_matters", i, matterId);
    }
  }

  function getMatterInfo(currentRec, sublistId) {
    const matterList = [];
    const headerMatterId = currentRec.getValue("cseg_mhi_matters");
    if (headerMatterId) {
      matterList.push(headerMatterId);
    }

    const lineCount = currentRec.getLineCount(sublistId);
    for (let i = 0; i < lineCount; i += 1) {
      const matterId = currentRec.getSublistValue(
        sublistId,
        "cseg_mhi_matters",
        i,
      );

      if (!matterId) continue;
      matterList.push(matterId);
    }

    const itemLineCount = currentRec.getLineCount("item");
    for (let j = 0; j < itemLineCount; j += 1) {
      const matterId = currentRec.getSublistValue(
        "item",
        "cseg_mhi_matters",
        j,
      );

      if (!matterId) continue;
      matterList.push(matterId);
    }

    log.debug("matterList", matterList);

    if (matterList.length == 0) return;

    const matterSearchObj = search.create({
      type: "customrecord_cseg_mhi_matters",
      filters: [
        ["internalid", "anyof", matterList],
        "AND",
        ["isinactive", "is", "F"],
      ],
      columns: [
        "name",
        "internalid",
        "custrecord_client_name",
        "custrecord_practice_area",
        search.createColumn({
          name: "custrecord_mhi_practice_department",
          join: "custrecord_practice_area",
        }),
        "custrecordmhi_attorneys",
        "custrecordmhi_matter_id",
        "custrecordmhi_principal_attorney",
        "custrecord_mhi_matter_name",
        search.createColumn({
          name: "custrecord_mhi_location_id",
          join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
        }),
        search.createColumn({
          name: "custrecordmhi_department",
          join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
        }),
        search.createColumn({
          name: "custrecordmhi_practice_area",
          join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
        }),
      ],
    });

    const searchResults = matterSearchObj.run();
    const searchResult = getAllSearchResults(searchResults);

    for (var i = 0; i < searchResult.length; i += 1) {
      const result = searchResult[i];
      const id = result.getValue("internalid");
      const clientName = result.getValue("custrecord_client_name");
      const matterName = result.getValue("custrecord_mhi_matter_name");

      const principalAttorney = result.getValue(
        "custrecordmhi_principal_attorney",
      );
      const department = result.getValue({
        name: "custrecord_mhi_practice_department",
        join: "custrecord_practice_area",
      });
      const location = result.getValue({
        name: "custrecord_mhi_location_id",
        join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
      });
      const practiceArea = result.getValue({
        name: "custrecord_practice_area",
      });

      matterObj[id] = {
        clientName,
        principalAttorney,
        department,
        location,
        practiceArea,
        matterName,
      };
    }
  }

  /**
   * Get All search results.
   * @param {Array} searchResult - Search Results.
   */
  function getAllSearchResults(searchResult) {
    let arrResults = [];
    let resultSet = [];
    const MAX_SEARCH_SIZE = 1000;
    let count = 0;

    do {
      resultSet = searchResult.getRange({
        start: count,
        end: count + MAX_SEARCH_SIZE,
      });
      arrResults = arrResults.concat(resultSet);
      count += MAX_SEARCH_SIZE;
    } while (resultSet.length > 0);

    return arrResults;
  }

  return {
    beforeSubmit,
  };
});
