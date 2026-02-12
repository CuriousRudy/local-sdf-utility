/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([
  "./MHI_API_CIM_Variables.js",
  "N/search",
  "N/record",
  "N/runtime",
  "../MHI_lodash.js",
  "N/currentRecord",
  "N/url",
  "N/ui/message",
], function (VAR, SEARCH, RECORD, RUNTIME, _, CR, URL, MESSAGE) {
  const VARS = VAR.getVars();

  // ========================================== CIM_ADDBUTTON_UE/CS ==========================================
  // =========================================== CIM_ENTRY_UE/CS ============================================
  /**
   * Sets values on a record object if they are empty, based on a mapping and item field values.
   *
   * @param {Object} recObj - The record object to set values on.
   * @param {string} itemId - The ID of the item to look up field values for.
   */
  function setValuesIfEmpty(recObj, itemId, resultOb = false) {
    let itemFieldsLookup = false;
    if (resultOb) {
      itemFieldsLookup = resultOb;
    } else {
      itemFieldsLookup = getItemFieldValues(itemId);
    }
    log.audit("itemFieldsLookup", JSON.stringify(itemFieldsLookup));

    _.forEach(VARS.ITEMSET_MAP, (mapping) => {
      log.audit("MAPPING ITEMSET IN SETVALUESIFEMPTY", mapping);
      const hasValue = recObj.getValue({
        fieldId: mapping.field,
      });
      if (!hasValue) {
        const hasSearchVal = itemFieldsLookup[0].getValue(mapping.search);
        if (hasSearchVal) {
          recObj.setValue({
            fieldId: mapping.field,
            value: hasSearchVal,
          });
        }
      }
    });
  }

  //========================================= CIM_INVOICECREATECIM_UE =======================================
  function buildInvoiceLineItemObj(recordObj, targetObj) {
    const itemCount = recordObj.getLineCount({ sublistId: "item" });

    // did not fill out this information themselves when creating the record):
    // Display Name (item record)
    // Preferred Supplier (item record)
    // Primary Stock Unit (item record)
    // Primary Sales Unit (item record)
    // Customer Part # (item record if available) <<<<<<
    // Price level (invoice record if applicable)
    //     Custom Price (invoice record if applicable)
    //       If the order was a special deal, then the price should be set to (sold price – special order upcharge)
    // Resale UOM (from invoice UOM)
    // Sales Rep (customer record: segment)

    for (let i = 0; i < itemCount; i++) {
      const itemType = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "itemtype",
        line: i,
      });

      log.audit("Item Type", itemType);

      const item = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: i,
      });
      if (itemType !== "InvtPart") {
        log.audit("Skipping item due to type", { item, itemType });
        continue;
      }

      const quantity = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "quantity",
        line: i,
      });

      const pricelevel = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "price",
        line: i,
      });

      const uom = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "units",
        line: i,
      });

      const description = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "description",
        line: i,
      });

      const specDeal = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "custcol_mhi_sdm_dealid",
        line: i,
      });
      const spDlUpcharge = recordObj.getSublistValue({
        sublistId: "item",
        fieldId: "custcol_mhi_sdm_totrec",
        line: i,
      });
      const linerate = Number(
        recordObj.getSublistValue({
          sublistId: "item",
          fieldId: "rate",
          line: i,
        }),
      );

      targetObj[item] = {
        item,
        quantity,
        pricelevel,
        rate: (specDeal && linerate - spDlUpcharge) || linerate,
        uom,
        description,
        autocreated: true,
        specDeal,
      };
    }
  }

  function convertToBaseUnit(unitsType, convFrom, convTo, rate) {
    let convertedRate = rate;
    if (!unitsType || !convFrom) {
      return null;
    }

    try {
      let unitRef = {};
      const unitTypeRec = RECORD.load({
        type: "unitstype",
        id: unitsType,
        isDynamic: true,
      });
      // console.log("unit Type Rec", unitTypeRec);

      const uomCount = unitTypeRec.getLineCount({ sublistId: "uom" });
      // console.log("uomCount", uomCount);
      let baseUnit = null;
      let isBaseUnit = false;

      for (let i = 0; i < uomCount; i++) {
        unitTypeRec.selectLine("uom", i);
        const uomId = unitTypeRec.getCurrentSublistValue({
          sublistId: "uom",
          fieldId: "internalid",
        });
        // console.log("uom id", uomId);

        const conversionRate = unitTypeRec.getCurrentSublistValue({
          sublistId: "uom",
          fieldId: "conversionrate",
        });

        isBaseUnit = unitTypeRec.getCurrentSublistValue({
          sublistId: "uom",
          fieldId: "baseunit",
        });

        if (isBaseUnit) {
          baseUnit = uomId;
        }

        unitRef[uomId] = {
          conversionRate,
          isBaseUnit,
        };
      }

      // console.log("baseUnit", baseUnit);
      // console.log("rate", rate);
      // console.log("isBaseUnit", isBaseUnit);
      // debugger;

      if (baseUnit == convTo) convertedRate = rate;
      else {
        convertedRate = rate * unitRef[convTo].conversionRate;
      }

      // if (isBaseUnit) {
      //   convertedRate = rate;
      // } else {
      //   if (convTo == baseUnit) {
      //     convertedRate = rate / unitRef[convFrom.conversionRate];
      //   } else {
      //     convertedRate =
      //       (rate / unitRef[convFrom.conversionRate]) * unitRef[convTo];
      //   }
      // }
    } catch (e) {
      log.error("convertToBaseUnit error", e.message);
      return null;
    }
    // console.log("Converted Rate", convertedRate);
    return convertedRate;
  }

  function createCimRecord(cimCreateObj) {
    const cimId = {};
    const cimItemMap = VARS.ITEM_CIM_MAP;
    _.forEach(cimCreateObj.cimToCreate, (cimIt) => {
      const itemFields = getItemFieldValues(cimIt.item);

      try {
        const unTy = itemFields[0].getValue("unitstype");
        // const convertedRate = convertToBaseUnit(unTy, cimIt.uom, cimIt.rate);

        let cimRec = RECORD.create({
          type: VARS.CIM_RECORDID,
          isDynamic: true,
        });
        _.forEach(cimItemMap.header, (header) => {
          cimRec.setValue({
            fieldId: header.cimval,
            value: cimCreateObj[header.itemval],
          });
        });

        _.forEach(cimItemMap.lines, (line) => {
          log.debug({
            title: "MAP ITEMCIMMAP | line in forEach",
            details: { l: line, cimIt },
          });

          if (line.itemval == "rate") {
            log.audit("LOG ITEMFIELDS | cimItem", {
              cimIte: cimIt.uom,
            });
            log.audit("LOG ITEMFIELDS | saleunit", {
              saleunit: itemFields[0].getValue("saleunit"),
            });
            if (itemFields[0].getValue("saleunit") == cimIt.uom) {
              log.audit("LOG ITEMFIELDS | SALEUNIT", {
                cimIte: cimIt.uom,
                saleunit: itemFields[0].getValue("saleunit"),
              });
              cimRec.setValue({
                fieldId: VARS.CIM_CUSTPRICE,
                value: cimIt.rate,
              });
            }
          } else {
            cimRec.setValue({
              fieldId: line.cimval,
              value: cimIt[line.itemval],
            });
          }
        });

        log.audit("itemFields", itemFields);
        setValuesIfEmpty(cimRec, cimIt.item, itemFields);

        const priceLev = cimIt.pricelevel;
        let priceStrat;
        if (priceLev == VARS.ITEM_CUSTOM_PRICELVL) {
          priceStrat = VARS.CIM_CUSTOM_PRICING;
        } else {
          cimRec.setValue(VARS.CIM_PRICELEVEL, priceLev);
          priceStrat = VARS.CIM_MARGIN_PRICING;
        }
        cimRec.setValue(VARS.CIM_PRICESTRAT, priceStrat);

        // const vendorcode = itemFields[0].getValue("vendorcode");
        // if (vendorcode) {
        //   const itemPrice = FUNCS.getCustomerItemPrice(
        //     cimCreateObj.customer,
        //     vendorcode
        //   );
        //   log.audit("itemPrice", itemPrice);
        //   if (itemPrice) {
        //     cimRec.setValue({
        //       fieldId: VARS.CIM_CUSTPRICE,
        //       value: itemPrice,
        //     });
        //   }
        // }

        setNameField(cimRec);
        let saveCim = cimRec.save();
        if (saveCim) {
          cimId[cimIt.item] = saveCim;
        }
      } catch (e) {
        log.error("createCimRecord has error", e.message);
        cimId[cimIt.item] = e.message;
      }
    });

    return cimId;
  }
  // ============================================== CIM_SHARED ==============================================
  /**
   * Creates a CIM record and redirects the user to the appropriate URL for record entry.
   *
   * This function retrieves the current record's ID and type, constructs a URL with the necessary parameters,
   * and then redirects the user to the custom record entry page.
   *
   * @function
   * @name launchCimRecord
   *
   * @returns {void}
   */
  function launchCimRecord() {
    const sourceRecord = CR.get();
    const sourceId = sourceRecord.id;
    const sourceType = sourceRecord.type;
    const scheme = "https://";
    const host = URL.resolveDomain({
      hostType: URL.HostType.APPLICATION,
    });

    let paramsObj = {
      rectype: VARS.CIM_TYPEID,
      stype: sourceType,
    };

    if (sourceType === "customer") paramsObj.customer = sourceId;
    else paramsObj.itemid = sourceId;

    const urlString = URL.format({
      domain: `${scheme}${host}/app/common/custom/custrecordentry.nl`,
      params: paramsObj,
    });

    window.location.href = urlString;
  }

  /**
   * Retrieves specific field values for an item based on its internal ID.
   *
   * @param {number|string} itemid - The internal ID of the item to search for.
   * @returns {Array} An array containing the first result of the item search, including the following fields:
   *   - Display Name
   *   - Primary Stock Unit
   *   - Primary Sale Unit
   *   - Supplier Code
   *   - Preferred Supplier
   */
  function getItemFieldValues(itemid) {
    const itemSearchObj = SEARCH.create({
      type: "item",
      filters: [["internalid", "anyof", itemid]],
      columns: [
        SEARCH.createColumn({ name: "displayname", label: "Display Name" }),
        SEARCH.createColumn({ name: "stockunit", label: "Primary Stock Unit" }),
        SEARCH.createColumn({ name: "saleunit", label: "Primary Sale Unit" }),
        SEARCH.createColumn({ name: "vendorcode", label: "Supplier Code" }),
        SEARCH.createColumn({ name: "vendor", label: "Preferred Supplier" }),
        SEARCH.createColumn({ name: "unitstype", label: "Units Type" }),
        // SEARCH.createColumn({ name: "purchaseprice", label: "Purchase Price" }),
      ],
    });
    // return the first value
    return itemSearchObj.run().getRange({ start: 0, end: 1 });
  }

  /**
   * Sets the "name" field of the given record object by concatenating the customer and item text values.
   *
   * @param {Object} recObj - The record object to set the name field on.
   */
  function setNameField(recObj) {
    const customer = lookupCompanyName(
      recObj.getValue({ fieldId: VARS.CIM_CUSTOMER }),
    );
    const item = lookupItemName(recObj.getValue({ fieldId: VARS.CIM_ITEM }));

    log.audit("IN setNameField() ", { customer, item });

    if (customer && item) {
      recObj.setValue({
        fieldId: "name",
        value: `${customer} + ${item}`,
      });
    }
  }

  /**
   * Retrieves the price level of a specific item for a given customer.
   *
   * @param {number|string} customer - The internal ID of the customer record.
   * @param {number|string} item - The internal ID of the item.
   * @returns {number} The price level of the item for the customer. Returns 0.0 if the item is not found.
   */
  function getCustomerItemPrice(customer, item) {
    let itemPrice = 0.0;
    const loadCustomer = RECORD.load({
      type: RECORD.Type.CUSTOMER,
      id: customer,
    });

    const itemPricingLength = loadCustomer.getLineCount({
      sublistId: "itempricing",
    });

    for (let i = 0; i < itemPricingLength; i++) {
      const itemid = loadCustomer.getSublistValue({
        sublistId: "itempricing",
        fieldId: "item",
        line: i,
      });

      if (itemid == item) {
        itemPrice = loadCustomer.getSublistValue({
          sublistId: "itempricing",
          fieldId: "pricelevel",
          line: i,
        });
        break;
      }
    }
    return itemPrice;
  }

  /**
   * Checks for duplicate CIM records and displays a warning banner if a duplicate is found.
   *
   * @param {Object} recordObj - The current record object.
   * @param {boolean} [form=false] - Indicates whether to add a page init message to the form, defaults to false
   */
  function checkForDuplicateCimBanner(recordObj, type, form = false) {
    let hasDupe = false;
    let messageObject;
    let recType = false;

    if (type == "cim") {
      const customer = recordObj.getValue({ fieldId: VARS.CIM_CUSTOMER });
      const item = recordObj.getValue({ fieldId: VARS.CIM_ITEM });
      if (customer && item) {
        const searchForDupe = createSearchForLinkedCim(item, customer);
        const dupeResults = searchForDupe.run().each((result) => {
          let resId = result.id;
          if (resId == recordObj.id) return true;
          else {
            hasDupe = resId;
            recType = VARS.CIM_RECORDID;
            messageObject = {
              title: "Duplicate CIM Record found!",
              type: MESSAGE.Type.WARNING,
              message: `A CIM Record for this Item is already linked to the customer. <a href="*REPLACE*" target="_blank">View Record</a>`,
            };

            return false;
          }
        });
        log.audit("dupeResults", JSON.stringify(dupeResults));
      }
    } else {
      const hasInvLoc = recordObj.getValue({ fieldId: VARS.CIM_INVLOC });
      const itemId = recordObj.getValue({ fieldId: VARS.CIM_ITEM });

      const hasForecast = searchForLinkedForecastParent(
        recordObj.id,
        itemId,
        hasInvLoc,
      );

      if (hasForecast) {
        recType = VARS.FS_RECORDID;
        hasDupe = hasForecast;
        messageObject = {
          title: "Forecast Sales Record Exists!",
          type: MESSAGE.Type.WARNING,
          message: `A Forecast Sales record already Exists! <a href="*REPLACE*" target="_blank">View Record</a>`,
        };
      }
    }

    if (hasDupe) {
      hasDupe = URL.resolveRecord({
        recordType: recType,
        recordId: hasDupe,
      });

      _.assign(messageObject, {
        message: messageObject.message.replace("*REPLACE*", hasDupe),
      });

      if (form) {
        form.addPageInitMessage(messageObject);
      } else {
        MESSAGE.create(messageObject).show({ duration: 5000 });
      }
    }

    return hasDupe;
  }

  /**
   * Updates the header fields of a record object based on the provided parameters.
   *
   * @param {Object} recordObj - The record object to be updated.
   * @param {Object} paramsObj - The parameters object containing values for the header fields.
   * @param {string} [paramsObj.customer] - The customer ID to be set in the record.
   * @param {string} [paramsObj.itemid] - The item ID to be set in the record.
   *
   * @returns {void}
   */
  function checkParamsForHeaderFields(recordObj, paramsObj) {
    // this section was a small present to make the creation process a little more unique and readable.
    // I think seeing the pending values when you open the record in the UI looks better than TO BE GENERATED.

    let nameStr = "";

    if (paramsObj.customer) {
      recordObj.setValue({
        fieldId: VARS.CIM_CUSTOMER,
        value: paramsObj.customer,
      });

      const custName = lookupCompanyName(paramsObj.customer);

      nameStr = `${custName} + (PENDING)`;
    }

    if (paramsObj.itemid) {
      recordObj.setValue({
        fieldId: VARS.CIM_ITEM,
        value: paramsObj.itemid,
      });
      const itemName = lookupItemName(paramsObj.itemid);

      nameStr = `(PENDING) + ${itemName}`;
    }

    recordObj.setValue({
      fieldId: "name",
      value: nameStr,
    });
  }

  // ============================================== MISC_HELPERS ==============================================
  function getSalesTeamMembers(customerId, groupCustomers = false) {
    const customerMembers = {};
    const teamMembers = [];
    const salesTeamSearch = SEARCH.load({
      id: VARS.SALESTEAM_SEARCH,
    });
    salesTeamSearch.filters.push(
      SEARCH.createFilter({
        name: "internalid",
        operator: SEARCH.Operator.ANYOF,
        values: customerId,
      }),
    );

    salesTeamSearch.run().each((result) => {
      const memberId = result.getValue({ name: "salesteammember" });
      if (memberId) {
        if (groupCustomers) {
          const custId = result.id;
          if (!customerMembers[custId]) {
            customerMembers[custId] = [];
          }
          customerMembers[custId].push(memberId);
        } else {
          teamMembers.push(memberId);
        }
      }
      return true;
    });
    if (groupCustomers) return customerMembers;
    else return teamMembers;
  }

  function isSalesTeamMember(customerId, userOb, redirectOb) {
    // load the role prefs record search
    const searchObj = SEARCH.load("customsearch_mhi_api_productid_prefs_ss");
    let restrictRoles = [];

    searchObj.run().each((result) => {
      restrictRoles =
        (result.getValue("custrecord_mhi_api_cim_record_restrict") &&
          result
            .getValue("custrecord_mhi_api_cim_record_restrict")
            .split(",")) ||
        [];

      log.audit("Role Prefs", {
        restrictRoles,
      });
      return true;
    });

    const userId = userOb.id;
    const userRole = `${userOb.role}`;
    // if the role is defined on the custom record field, run the validation
    if (!!~restrictRoles.indexOf(userRole)) {
      const salesTeamSearch = SEARCH.load({
        id: VARS.SALESTEAM_SEARCH,
      });
      salesTeamSearch.filters.push(
        SEARCH.createFilter({
          name: "internalid",
          operator: SEARCH.Operator.ANYOF,
          values: customerId,
        }),
      );
      salesTeamSearch.filters.push(
        SEARCH.createFilter({
          name: "salesteammember",
          operator: SEARCH.Operator.ANYOF,
          values: userId,
        }),
      );

      const searchResult = salesTeamSearch.run().getRange({ start: 0, end: 1 });
      const hasResult = searchResult.length > 0;
      if (!hasResult) {
        redirectOb.toTaskLink({
          id: "CARD_-29",
        });
      }
    } else {
      return true;
    }
  }

  /**
   * Looks up the company name and entity ID of a customer by their customer ID.
   *
   * @param {string} customerid - The internal ID of the customer to look up.
   * @returns {string} A string containing the entity ID and company name of the customer.
   */
  function lookupCompanyName(customerid) {
    const customerLookup = SEARCH.lookupFields({
      type: RECORD.Type.CUSTOMER,
      id: customerid,
      columns: ["entityid", "companyname"],
    });
    const entityId = customerLookup.entityid;
    const companyName = customerLookup.companyname;

    return `${entityId} ${companyName}`;
  }

  /**
   * Looks up the item name for a given item ID.
   *
   * @param {string} itemid - The ID of the item to look up.
   * @returns {string} The item ID of the looked-up item.
   */
  function lookupItemName(itemid) {
    const itemLookup = SEARCH.lookupFields({
      type: RECORD.Type.INVENTORY_ITEM,
      id: itemid,
      columns: ["itemid", "displayname"],
    });
    return itemLookup.itemid;
  }

  /**
   * Looks up the sales representative for a given customer.
   *
   * @param {string} customer - The internal ID of the customer.
   * @returns {string|null} The internal ID of the sales representative if found, otherwise null.
   */
  function lookupCustomerSalesRep(customer) {
    const custLook = SEARCH.lookupFields({
      type: "customer",
      id: customer,
      columns: ["salesrep"],

      // filters: [
      //   ["internalid", "anyof", customer],
      // ],
      // columns: ["salesrep"],
    });

    if (custLook.salesrep) {
      return (custLook.salesrep[0] && custLook.salesrep[0].value) || "";
    } else {
      return null;
    }
  }

  /**
   * Creates a search for linked CIM (Customer Item Matrix) records based on item IDs and customer.
   *
   * @param {Array<number>} itemIds - An array of item IDs to search for.
   * @param {number} customer - The customer ID to search for.
   * @returns {Object} The search object configured with the specified filters and columns.
   */
  function createSearchForLinkedCim(itemIds, customer) {
    if (!itemIds || itemIds.length === 0) {
      return false;
    }

    return SEARCH.create({
      type: "customrecord_mhi_cim_parentrecord",
      filters: [
        [VARS.CIM_ITEM, "anyof", itemIds],
        "AND",
        [VARS.CIM_CUSTOMER, "anyof", customer],
        "AND",
        [["isinactive", "is", "F"], "OR", [VARS.CIM_STATUS, "noneof", "2"]],
      ],
      columns: ["internalid", VARS.CIM_ITEM],
    });
  }

  function searchForLinkedForecastParent(cimParent, item, location) {
    let hasForecast = false;

    const forecastSearch = SEARCH.create({
      type: VARS.FS_RECORDID,
      filters: [
        [VARS.FS_CIMPARENT, "anyof", cimParent],
        "AND",
        [VARS.FS_ITEM, "anyof", item],
        "AND",
        [VARS.FS_LOCATION, "anyof", location],
      ],
      // columns: ["internalid"],
    });

    forecastSearch.run().each((result) => {
      if (!hasForecast) {
        hasForecast = result.id;
        return false;
      }
      return true;
    });

    return hasForecast;
  }

  function createForecastRecord(cimRecord) {
    const cimParent = cimRecord.id;
    const cimSubmitObj = {};
    const forecastMapping = VARS.FORECAST_MAP;
    const cimName = cimRecord.getValue({ fieldId: "name" });
    const location = cimRecord.getValue({ fieldId: VARS.CIM_INVLOC });
    const locName = getLocationName(location);

    if (cimName && locName) {
      let forecastId = 0;
      const forecastRecord = RECORD.create({
        type: VARS.FS_RECORDID,
      });

      forecastRecord.setValue({
        fieldId: "name",
        value: `${cimName} + ${locName}`,
      });

      forecastRecord.setValue({
        fieldId: VARS.FS_CIMPARENT,
        value: cimParent,
      });

      _.forEach(forecastMapping, (fieldmap) => {
        // try {
        const cimValue = cimRecord.getValue({ fieldId: fieldmap.cimval });
        forecastRecord.setValue({
          fieldId: fieldmap.forecastval,
          value: cimValue,
        });

        if (fieldmap.bool) {
          cimSubmitObj[fieldmap.cimval] = false;
        } else {
          cimSubmitObj[fieldmap.cimval] = "";
        }
      });

      forecastId = forecastRecord.save();
    }

    if (forecastId) {
      // let isCimUpdate = RECORD.submitFields({
      //   type: VARS.CIM_RECORDID,
      //   id: cimParent,
      //   values: cimSubmitObj,
      // });
      // return isCimUpdate && forecastId;
      return true;
    } else {
      return false;
    }
  }

  function getLocationName(locationid) {
    let locationName = "";
    const locLook = SEARCH.lookupFields({
      type: RECORD.Type.LOCATION,
      id: locationid,
      columns: ["name"],
    });
    locationName = locLook.name;
    return locationName;
  }

  function genTableData(type = false) {
    let htmlStr = "";
    htmlStr += "  <table style='font-size: 8pt;'>";
    htmlStr += "  <tr>";
    htmlStr += "    <th>Button Name</th>";
    htmlStr += "    <th>Description</th>";
    htmlStr += "  </tr>";
    htmlStr += "  <tr>";
    htmlStr += "    <td>Confirm and Save</td>";
    if (type == "cim") {
      htmlStr +=
        "    <td>Inventory Location already has Forecast Sales Record. Clicking confirm will Create a Duplicate</td>";
    } else {
      htmlStr +=
        "    <td>Allows you to save the Item. Click Save again to continue...</td>";
    }
    htmlStr += "  </tr>";
    htmlStr += "  <tr>";
    htmlStr += "    <td>Go Back and Edit</td>";
    htmlStr +=
      "    <td>Cancel the save operation and return to editing the record.</td>";
    htmlStr += "  </tr>";
    htmlStr += "</table>";
    return htmlStr;
  }

  function getCimValuesForItem(itemid, customer) {
    let cimSearch = createSearchForLinkedCim([itemid], customer);

    let cimCols = VARS.CIM_ITEMLINE_MAP.map((field) => {
      return field.cimval;
    });

    cimCols.forEach((col) => {
      cimSearch.columns.push(
        SEARCH.createColumn({
          name: col,
        }),
      );
    });
    let searchResults = cimSearch.run().getRange({ start: 0, end: 1000 });
    // console.log("SEARCH RESULTS", { l: searchResults.length, searchResults });
    let resultObj = {};

    if (searchResults.length > 0) {
      if (searchResults[0]) {
        _.forEach(cimCols, (col) => {
          resultObj[col] = searchResults[0].getValue({ name: col });
        });
        resultObj.internalid = searchResults[0].id;
        const cimParentUrl = URL.resolveRecord({
          recordType: VARS.CIM_RECORDID,
          recordId: searchResults[0].id,
        });

        resultObj.recUrl = cimParentUrl;
      } else {
        resultObj = false;
      }
    } else {
      resultObj = false;
    }
    return resultObj;
  }

  function getLinkedSalesHistoryRecs(fcSalesRec) {
    let searchForHistory = SEARCH.create({
      type: VARS.FSH_RECORDID,
      filters: [[VARS.FSH_PARENT_FS, "anyof", fcSalesRec]],
      columns: [],
    });
    const currMonthId = VARS.FSH_CURRMONTH_ID;
    for (let i = 0; i <= 12; i++) {
      searchForHistory.columns.push(
        SEARCH.createColumn({
          name: (i > 0 && `${currMonthId}${i}`) || currMonthId,
        }),
      );
    }

    const reviewDateId = VARS.FSH_REVIEWDATE_ID;
    for (let i = 0; i <= 2; i++) {
      searchForHistory.columns.push(
        SEARCH.createColumn({
          name: (i > 0 && `${reviewDateId}${i}`) || `${reviewDateId}cu`,
        }),
      );
    }

    let hasId = false;

    // return searchForHistory;
    const results = searchForHistory.run().getRange({ start: 0, end: 1 });
    if (results.length > 0) {
      hasId = results[0];
    }
    return hasId;
  }

  return {
    setValuesIfEmpty,
    buildInvoiceLineItemObj,
    createCimRecord,
    launchCimRecord,
    getItemFieldValues,
    setNameField,
    getCustomerItemPrice,
    checkForDuplicateCimBanner,
    checkParamsForHeaderFields,
    isSalesTeamMember,
    getSalesTeamMembers,
    lookupCompanyName,
    lookupItemName,
    lookupCustomerSalesRep,
    createSearchForLinkedCim,
    searchForLinkedForecastParent,
    createForecastRecord,
    // getLocationName,
    genTableData,
    getCimValuesForItem,
    getLinkedSalesHistoryRecs,
    convertToBaseUnit,
  };
});
