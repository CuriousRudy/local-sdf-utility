/**
 *@NApiVersion 2.1
 *@NScriptType ClientScript
 */
define(["N/search"], (search) => {
  var matterObj = {};
  var headerFieldObj = {
    department: "department",
    location: "location",
  };
  var lineFieldObj = {
    department: "department",
    location: "location",
    principalAttorney: "cseg_mhi_attorney",
    practiceArea: "class",
    clientName: "cseg_mhi_clients",
    // clientName: "custcol_mhi_wlf_client_name",
    matterName: "custcolmhi_matter_name",
  };
  function saveRecord(context) {
    var currentRec = context.currentRecord;

    var sublistId =
      currentRec.type == "journalentry" ||
      currentRec.type == "advintercompanyjournalentry"
        ? "line"
        : "expense";
    var lineCount = currentRec.getLineCount(sublistId);
    getMatterInfo(currentRec, sublistId);
    setHeaderMatterFields(currentRec);
    setLineMatterFields(currentRec, sublistId);

    return true;
  }

  function setLineMatterFields(currentRec, sublistId, lineMatter) {
    debugger;

    if (lineMatter) {
      if (!matterObj[lineMatter]) return;
      for (var propertyName in lineFieldObj) {
        var fieldId = lineFieldObj[propertyName];
        var fieldValue = matterObj[lineMatter][propertyName] || "";
        currentRec.setCurrentSublistValue(sublistId, fieldId, fieldValue);
      }
    } else {
      var lineCount = currentRec.getLineCount(sublistId);
      var headerMatterId = currentRec.getValue("cseg_mhi_matters");
      for (var i = 0; i < lineCount; i += 1) {
        var matterId = currentRec.getSublistValue(
          sublistId,
          "cseg_mhi_matters",
          i
        );
        if (!matterId) {
          matterId = headerMatterId;
        }

        if (!matterId) return;
        currentRec.selectLine(sublistId, i);

        for (var propertyName in lineFieldObj) {
          var fieldId = lineFieldObj[propertyName];
          var fieldValue = matterObj[matterId]
            ? matterObj[matterId][propertyName]
            : "" || "";
          currentRec.setCurrentSublistValue(sublistId, fieldId, fieldValue);
        }

        currentRec.commitLine(sublistId);
      }

      var itemLineCount = currentRec.getLineCount("item");
      for (var j = 0; j < itemLineCount; j += 1) {
        var matterId = currentRec.getSublistValue(
          "item",
          "cseg_mhi_matters",
          j
        );
        if (!matterId) {
          matterId = headerMatterId;
        }

        if (!matterId) return;
        currentRec.selectLine("item", j);

        for (var propertyName in lineFieldObj) {
          var fieldId = lineFieldObj[propertyName];
          var fieldValue = matterObj[matterId]
            ? matterObj[matterId][propertyName]
            : "" || "";
          currentRec.setCurrentSublistValue("item", fieldId, fieldValue);
        }

        currentRec.commitLine("item");
      }
    }
  }

  function setHeaderMatterFields(currentRec) {
    debugger;

    var headerMatterId = currentRec.getValue("cseg_mhi_matters");
    if (!headerMatterId) return;

    for (var propertyName in headerFieldObj) {
      var fieldId = headerFieldObj[propertyName];
      var fieldValue = matterObj[headerMatterId]
        ? matterObj[headerMatterId][propertyName]
        : "" || "";
      currentRec.setValue(fieldId, fieldValue);
    }
  }

  function getMatterInfo(currentRec, sublistId, matterOnLine) {
    debugger;
    var matterList = [];
    var headerMatterId = currentRec.getValue("cseg_mhi_matters");
    if (headerMatterId) {
      matterList.push(headerMatterId);
    }

    if (matterOnLine) {
      matterList.push(matterOnLine);
    } else {
      var lineCount = currentRec.getLineCount(sublistId);
      for (var i = 0; i < lineCount; i += 1) {
        var matterId = currentRec.getSublistValue(
          sublistId,
          "cseg_mhi_matters",
          i
        );
        log.debug("matterId", matterId);

        if (!matterId) continue;
        matterList.push(matterId);
      }

      // For invoice and cash sale, we also need to check item sublist
      var itemLineCount = currentRec.getLineCount("item");
      for (var j = 0; j < itemLineCount; j += 1) {
        var matterId = currentRec.getSublistValue(
          "item",
          "cseg_mhi_matters",
          j
        );

        if (!matterId) continue;
        matterList.push(matterId);
      }
    }

    log.debug("matterList", matterList);

    if (matterList.length == 0) return;

    var matterSearchObj = search.create({
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

    var searchResults = matterSearchObj.run();
    var searchResult = getAllSearchResults(searchResults);

    for (var i = 0; i < searchResult.length; i += 1) {
      var result = searchResult[i];
      var id = result.getValue("internalid");
      var clientName = result.getValue("custrecord_client_name");
      var matterName = result.getValue("custrecord_mhi_matter_name");

      var principalAttorney = result.getValue(
        "custrecordmhi_principal_attorney"
      );
      var department = result.getValue({
        name: "custrecordmhi_department",
        join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
      });
      var location = result.getValue({
        name: "custrecord_mhi_location_id",
        join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
      });
      var practiceArea = result.getValue({
        name: "custrecordmhi_practice_area",
        join: "CUSTRECORDMHI_PRINCIPAL_ATTORNEY",
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
   * Get All search results.`
   * @param {Array} searchResult - Search Results.
   */
  function getAllSearchResults(searchResult) {
    var arrResults = [];
    var resultSet = [];
    var MAX_SEARCH_SIZE = 1000;
    var count = 0;

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

  function fieldChanged(context) {
    var currentRec = context.currentRecord;
    var sublistId = context.sublistId;
    var fieldId = context.fieldId;

    // if (!sublistId) return;

    if (fieldId == "cseg_mhi_matters") {
      debugger;
      var matterId = currentRec.getValue("cseg_mhi_matters");

      if (!matterId && !sublistId) return;
      if (!matterObj[matterId]) {
        getMatterInfo(currentRec, sublistId, matterId);
      }

      console.log("matterObj", matterObj);
      if (sublistId) {
        var lineMatterId = currentRec.getCurrentSublistValue(
          sublistId,
          "cseg_mhi_matters"
        );

        if (!matterObj[lineMatterId] && !matterId) {
          getMatterInfo(currentRec, sublistId, lineMatterId);
        }

        setLineMatterFields(currentRec, sublistId, lineMatterId || matterId);
      } else {
        var sublistInternalId =
          currentRec.type == "journalentry" ||
          currentRec.type == "advintercompanyjournalentry"
            ? "line"
            : "expense";
        setHeaderMatterFields(currentRec);
        var lineCount = currentRec.getLineCount(sublistInternalId);
        for (var i = 0; i < lineCount; i += 1) {
          currentRec.selectLine(sublistInternalId, i);
          currentRec.setCurrentSublistValue(
            sublistInternalId,
            "cseg_mhi_matters",
            matterId
          );
          currentRec.commitLine(sublistInternalId);
        }

        var itemLineCount = currentRec.getLineCount("item");
        for (var j = 0; j < itemLineCount; j += 1) {
          currentRec.selectLine("item", j);
          currentRec.setCurrentSublistValue(
            "item",
            "cseg_mhi_matters",
            matterId
          );
          currentRec.commitLine("item");
        }
      }
    } else if (fieldId == "item" && sublistId) {
      var headerMatterId = currentRec.getValue("cseg_mhi_matters");
      if (headerMatterId) {
        currentRec.setCurrentSublistValue(
          "sublistId",
          "cseg_mhi_matters",
          headerMatterId
        );
      }
    }
  }

  return {
    fieldChanged: fieldChanged,
    saveRecord: saveRecord,
  };
});
