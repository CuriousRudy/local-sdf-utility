/* eslint-disable quotes */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-nested-ternary */
/* eslint-disable camelcase */
/* eslint-disable max-len */
/* Script intent is to periodically pull all ready to send Bill Payments and format an ISO file to be posted on the Shared SFTP.
 */
/**
 *@NApiVersion 2.1
 *@NScriptType MapReduceScript
 *@NAmdConfig /SuiteScripts/Myers-Holum/Libraries/MHI_Aura_Configurations.json
 */
define([
  "N/search",
  "N/record",
  "N/email",
  "N/runtime",
  "N/file",
  "N/sftp",
  "N/pgp",
  "N/crypto/certificate",
  "N/encode",
  "auraLib",
  "tranmapping",
  "N/xml",
], (
  search,
  record,
  email,
  runtime,
  file,
  sftp,
  pgp,
  certificate,
  encode,
  auraLib,
  tranmapping,
  xml,
) => {
  // Global Variables:
  let constants = {};
  let usAccBIC = "021000021";
  const namespace = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";
  let intAccBIC = "CHASCHGX";
  // const intAccBICBoC = 'GKCCBEBB';
  let logTitle = "";
  let useForeignCurrency = ""; // JPM Processes in Foreign Currency. BoC does not.
  const vbSearchPhrase = "VENDPYMT";
  const addressError =
    "The Payee Address is missing Address line 1, City, State, Zip, or Country.";
  const returnAddressError =
    "The Return Address is missing Address line 1, City, State, Zip, or Country for the Given Payment Account.";
  const bankDetError =
    "The Vendor is missing Details related to the Primary Bank Account";
  const emailError =
    "The Vendor is missing an Email. Emails are required for ACH Payments";
  const bankError =
    "The Account Linked with this Payment record is missing Banking Information. Please ensure the routing number and account number are set on the Account record.";
  const { tranfields } = tranmapping;
  /**
   * Retrieves the input data for the Map/Reduce script.
   *
   * @returns {search.Search} A search object representing the data to be processed.
   */
  function getInputData() {
    logTitle = "GetInput_";

    try {
      constants = auraLib.getConstants() || {};
      constants.isJPMDeployment =
        runtime
          .getCurrentScript()
          .getParameter("custscript_mhi_jpm_deployment") || "";
      constants.isBoCDeployment =
        runtime
          .getCurrentScript()
          .getParameter("custscript_mhi_boc_deployment") || "";
      const pymtSearch =
        runtime
          .getCurrentScript()
          .getParameter("custscript_mhi_gen_pymt_search") || "";
      log.debug({ title: logTitle + "pymtSearch", details: pymtSearch });

      if (constants.isJPMDeployment) {
        logTitle += "JPM_";
      } else if (constants.isBoCDeployment) {
        logTitle += "BoC_";
      }

      if (!pymtSearch) {
        throw new Error(
          "Missing payment search parameter (custscript_mhi_gen_pymt_search).",
        );
      }

      const vendorpaymentSearchObj = search.load({ id: pymtSearch });

      return vendorpaymentSearchObj;
    } catch (error) {
      log.error("getInputData::error", error);
      log.error({ title: logTitle + "Error", details: error.message });
      return null;
    }
  }

  /**
   * Map function for processing vendor payments in a Map/Reduce script.
   * @param {Object} context - The context object provided by NetSuite's Map/Reduce framework.
   */
  function map(context) {
    let error = "";
    logTitle = "MAP_";

    try {
      const vendorPymtRecID = context.key;
      const data = JSON.parse(context.value) || {};

      if (!vendorPymtRecID || !data) {
        throw new Error("Missing or invalid context data.");
      }

      constants = auraLib.getConstants() || {};
      constants.isJPMDeployment =
        runtime
          .getCurrentScript()
          .getParameter({ name: "custscript_mhi_jpm_deployment" }) || "";
      constants.isBoCDeployment =
        runtime
          .getCurrentScript()
          .getParameter({ name: "custscript_mhi_boc_deployment" }) || "";

      if (constants.isJPMDeployment) {
        logTitle += "JPM_";
        useForeignCurrency = true;
      } else if (constants.isBoCDeployment) {
        logTitle += "BoC_";
        usAccBIC = "122238200";
        intAccBIC = "122238200";
      }

      const entityDetails = getEntityDetails(data, constants);
      if (vendorPymtRecID) {
        const vpRec = record.load({
          type: "vendorpayment",
          id: vendorPymtRecID,
        });
        const bankDetObj = getBankDetailsIfNeeded(entityDetails);
        log.debug({ title: logTitle + "bankDetObj", details: bankDetObj });

        if (
          !isValidBankDetails(bankDetObj) &&
          (entityDetails.isACH || entityDetails.isWire)
        ) {
          error = formatError(bankDetError);
        }

        // log.debug({ title: logTitle + 'bankDetObj', details: bankDetObj });

        const returnAddress = getReturnAddress(data);
        const vendorAddress = getVendorAddress(vpRec);
        const vendorAddressID = vpRec.getValue("payeeaddress") || "";

        log.debug({
          title: logTitle + "vendorAddress",
          details: vendorAddress,
        });
        log.debug({
          title: logTitle + "returnAddress",
          details: returnAddress,
        });

        if (
          isInvalidVendorAddress(
            vendorAddress,
            vendorAddressID,
            entityDetails.isWire,
            entityDetails.isCheck,
          )
        ) {
          error = formatError(addressError);
        }

        if (isInvalidReturnAddress(returnAddress)) {
          error = formatError(returnAddressError);
        }

        // Modify entity payment type for international transactions
        if (vendorAddress.payeeCountry !== "US" && entityDetails.isWire) {
          entityDetails.entityPymtTypeName += "Int";
        }

        const accountDetails = getAccountDetails(entityDetails.account);
        error = error || accountDetails.error;

        if (entityDetails.isACH && !entityDetails.vendorEmail) {
          error = formatError(emailError);
        }

        const valueObj = buildValueObject(
          vendorPymtRecID,
          entityDetails,
          vendorAddress,
          returnAddress,
          bankDetObj,
          accountDetails,
        );

        log.debug({
          title: "entityDetails.entityPymtTypeName",
          details: entityDetails.entityPymtTypeName,
        });
        log.debug({ title: "valueObj", details: valueObj });

        if (error) {
          log.audit({ title: logTitle + " error", details: error });
          updateErrorRecord(vendorPymtRecID, error);
        } else {
          context.write({
            key: constants.isJPMDeployment
              ? "All"
              : entityDetails.entityPymtTypeName,
            value: valueObj,
          });
        }
      }
    } catch (err) {
      log.error("map::err", err);
      log.error({
        title: logTitle + " Unexpected Error",
        details: err.message,
      });
    }
  }

  /**
   * Reduces the mapped data and processes customer shipments and Sales Order updates.
   *
   * @param {Object} context - The context object containing the reduced data to be processed.
   */
  // eslint-disable-next-line consistent-return
  function reduce(context) {
    logTitle = "REDUCE_";
    const summaryValues = [];

    try {
      // Retrieve constants safely
      constants = auraLib.getConstants() || {};
      const scriptObj = runtime.getCurrentScript();

      constants.isJPMDeployment =
        scriptObj.getParameter({ name: "custscript_mhi_jpm_deployment" }) || "";
      constants.isBoCDeployment =
        scriptObj.getParameter({ name: "custscript_mhi_boc_deployment" }) || "";

      const reduceKey = context.key || "";
      const dataObj = context.values || [];

      const { isJPMDeployment, isBoCDeployment } = constants;
      let generateFile = {};

      if (isJPMDeployment) {
        logTitle += "JPM_" + reduceKey;
      } else if (isBoCDeployment) {
        logTitle += "BoC_" + reduceKey;
      }

      log.audit({ title: logTitle, details: dataObj });

      // Validate and format data
      const { headerObj, vpIDs, batchingObj } = formatData(dataObj);
      log.debug("formatData", { headerObj, vpIDs });
      log.debug("formatData", { batchingObj });

      if (!headerObj || !vpIDs || !batchingObj) {
        throw new Error("Invalid data structure from formatData");
      }

      // Generate file based on deployment type
      if (isJPMDeployment) {
        generateFile = generateJPMFile(headerObj, batchingObj);
      } else if (isBoCDeployment) {
        log.debug({
          title: logTitle + "BoC Deployment",
          details: "Generating BoC file",
        });
        generateFile = generateBOCFile(headerObj, batchingObj);
      }

      const { fileId, errorMessage, fileName, fileIdXML } = generateFile || {};

      if (errorMessage) {
        summaryValues.push({ errorText: errorMessage });
      }

      log.audit({ title: logTitle + "File ID", details: fileId });
      log.audit({ title: logTitle + "File Name", details: fileName });
      log.audit({ title: logTitle + "File ID XML", details: fileIdXML });

      if (fileId) {
        const uploaded = connectSFTP(fileId, fileName);
        log.audit({ title: logTitle + "uploaded", details: uploaded });

        if (uploaded) {
          return Promise.all(
            vpIDs
              .filter(Boolean)
              .map((vpID) => updateVP(vpID, fileIdXML, fileName)),
          )
            .then((updatedRecords) => {
              log.audit({
                title: "All Vendor Payments Updated",
                details: updatedRecords,
              });
              context.write(reduceKey, summaryValues);
            })
            .catch((error) => {
              log.error({
                title: "Error Updating Vendor Payments",
                details: error,
              });
              context.write(reduceKey, [{ errorText: error.message }]);
            });
        }
      }
    } catch (error) {
      log.error("reduce::error", error);

      log.error({
        title: logTitle + " Unexpected Error",
        details: error.message,
      });
      context.write(context.key || "Error", [{ errorText: error.message }]);
    }
  }

  /**
   * Logs the summary information.
   *
   * @param {Object} summary - The summary object to be logged.
   */
  function summarize(summary) {
    log.audit(logTitle + "summary", summary);
  }

  /**
   * Validates the vendor address based on specific rules for Wire and Check payments.
   * @param {Object} vendorAddress - The vendor's address details.
   * @param {string} vendorAddressID - The vendor's address ID.
   * @param {boolean} isWire - Whether the payment type is Wire.
   * @param {boolean} isCheck - Whether the payment type is Check.
   * @returns {boolean} - Returns true if the address is invalid, otherwise false.
   */
  function isInvalidVendorAddress(
    vendorAddress,
    vendorAddressID,
    isWire,
    isCheck,
  ) {
    const { payeeCity, payeeState, payeeAdd1, payeeZip, payeeCountry } =
      vendorAddress;
    if (isWire || (isCheck && constants.isBoCDeployment)) {
      if (
        !payeeCity ||
        (!payeeState && (payeeCountry === "US" || payeeCountry === "CA")) ||
        !payeeAdd1 ||
        (!payeeZip && (payeeCountry === "US" || payeeCountry === "CA")) ||
        !payeeCountry ||
        !vendorAddressID
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validates the return address by ensuring the country is present.
   * @param {Object} returnAddress - The return address details.
   * @returns {boolean} - Returns true if the return address is invalid, otherwise false.
   */
  function isInvalidReturnAddress(returnAddress) {
    return !returnAddress.returnCountry;
  }

  /**
   * Extracts entity-related details from the data.
   * @param {Object} data - The data object from the Map context.
   * @param {Object} constants - Constants object.
   * @returns {Object} - Extracted entity details.
   */
  function getEntityDetails(data) {
    const isAch =
      data.values.custbody_mhi_payment_type &&
      data.values.custbody_mhi_payment_type.value === constants.isACH;
    const payerType =
      data.values["isperson.vendor"] === "T" ||
      !!(
        data.values["internalid.employee"] &&
        data.values["internalid.employee"].value
      )
        ? "PPD"
        : "CCD";
    return {
      vendorEmail: data.values["email.vendor"]
        ? data.values["email.vendor"]
        : "",
      pymtAmt: useForeignCurrency
        ? Number(data.values.fxamount) * -1
        : Number(data.values.amount) * -1,
      vendorID:
        data.values["internalid.vendor"] &&
        data.values["internalid.vendor"].value
          ? data.values["internalid.vendor"].value
          : "",
      isEmployee: !!(
        data.values["internalid.employee"] &&
        data.values["internalid.employee"].value
      ),
      employeeEmail: data.values["email.employee"]
        ? data.values["email.employee"]
        : "",
      currencyID: useForeignCurrency
        ? data.values.currency
          ? data.values.currency.value
          : ""
        : constants.systemCurrency,
      currSymbol: useForeignCurrency
        ? data.values["symbol.Currency"]
          ? data.values["symbol.Currency"]
          : ""
        : "USD",
      employeeID: data.values["entityid.employee"]
        ? data.values["entityid.employee"]
        : "",
      vendID: data.values["entityid.vendor"]
        ? data.values["entityid.vendor"]
        : "",
      // vendName: data.values['altname.vendor'] ? data.values['altname.vendor'] : '',
      memo: data.values.memo ? data.values.memo : "",
      account:
        data.values.account && data.values.account.value
          ? data.values.account.value
          : "",
      vendorName: data.values["companyname.vendor"]
        ? data.values["companyname.vendor"]
        : "",
      // vendorName: data.values['altname.vendor'] ? data.values['altname.vendor'] : '',
      // vendorName: data.values.entity && data.values.entity.text ? data.values.entity.text : '',
      entityPymtType:
        data.values.custbody_mhi_payment_type &&
        data.values.custbody_mhi_payment_type.value
          ? data.values.custbody_mhi_payment_type.value
          : "",
      entityPymtTypeName:
        data.values.custbody_mhi_payment_type &&
        data.values.custbody_mhi_payment_type.text
          ? data.values.custbody_mhi_payment_type.text
          : "",
      isACH:
        data.values.custbody_mhi_payment_type &&
        data.values.custbody_mhi_payment_type.value === constants.isACH,
      isCheck:
        data.values.custbody_mhi_payment_type &&
        data.values.custbody_mhi_payment_type.value === constants.isJPMCheck,
      isWire:
        data.values.custbody_mhi_payment_type &&
        data.values.custbody_mhi_payment_type.value === constants.isWire,
      tranID: data.values.transactionnumber
        ? data.values.transactionnumber
        : "",
      chckNum: data.values.tranid || "",
      tranDate: data.values.trandate ? data.values.trandate : "",
      payerType: isAch ? payerType : "NA",
    };
  }

  /**
   * Retrieves account details.
   * @param {string} accountID - Account ID.
   * @returns {Object} - Account details object.
   */
  function getAccountDetails(accountID) {
    if (!accountID) return { error: formatError(bankError) };

    const accObj = record.load({ type: "account", id: accountID });
    const accountNum = accObj.getValue("sbankcompanyid") || "";
    return {
      accountRN: accObj.getValue("sbankroutingnumber") || "",
      accountNum,
      accBIC:
        accountNum.length >= 4 &&
        accountNum.substring(accountNum.length - 4) === "0838"
          ? intAccBIC
          : usAccBIC,
      error:
        !accObj.getValue("sbankroutingnumber") || !accountNum
          ? formatError(bankError)
          : "",
    };
  }

  /**
   * Retrieves return address details.
   * @param {Object} data - The data object.
   * @returns {Object} - Return address object.
   */
  function getReturnAddress(data) {
    const returnAddress = {
      returnCity: "",
      returnState: "",
      returnAdd1: "",
      returnZip: "",
      returnCountry: "",
    };

    log.audit("data.values", data.values);

    returnAddress.returnCity = data.values["city.subsidiary"]
      ? data.values["city.subsidiary"]
      : "";
    returnAddress.returnState = data.values["state.subsidiary"]
      ? data.values["state.subsidiary"].value
      : "";
    returnAddress.returnAdd1 = data.values["address1.subsidiary"]
      ? data.values["address1.subsidiary"]
      : "";
    returnAddress.returnZip = data.values["zip.subsidiary"]
      ? data.values["zip.subsidiary"]
      : "";
    returnAddress.returnCountry = data.values["country.subsidiary"]
      ? data.values["country.subsidiary"].value
      : "";

    // remove any 'undefined' values
    for (const key in returnAddress) {
      if (returnAddress[key] === undefined) {
        returnAddress[key] = "";
      }
    }

    return returnAddress;
  }

  /**
   * Retrieves vendor address details from the vendor payment record.
   * @param {Object} vpRec - The vendor payment record.
   * @returns {Object} - Vendor address object.
   */
  function getVendorAddress(vpRec) {
    const sublistSubrec = vpRec.getSubrecord("payeeaddress");
    return {
      payeeCity: sublistSubrec.getValue("city") || "",
      payeeState: sublistSubrec.getValue("state") || "",
      payeeAdd1: sublistSubrec.getValue("addr1") || "",
      payeeAdd2: sublistSubrec.getValue("addr2") || "",
      payeeAdd3: sublistSubrec.getValue("addr3") || "",
      payeeZip: sublistSubrec.getValue("zip") || "",
      payeeCountry: sublistSubrec.getValue("country") || "",
    };
  }

  /**
   * Updates the vendor payment record with an error message.
   * @param {string} vendorPymtRecID - The vendor payment record ID.
   * @param {string} error - The error message.
   */
  function updateErrorRecord(vendorPymtRecID, error) {
    auraLib.updateRec(
      vendorPymtRecID,
      {
        [tranfields.jpmError]: error,
        [tranfields.jpmPymtFile]: "",
        [tranfields.jpmPymtFileName]: "",
        [tranfields.jpmPymtStatus]: constants.jpmError,
      },
      "vendorpayment",
      true,
    );
  }

  function getFirstPayeeCountry(data) {
    for (let i = 0; i < data.length; i += 1) {
      if (data[i].vendorAddress && data[i].vendorAddress.payeeCountry) {
        return data[i].vendorAddress.payeeCountry;
      }
    }

    return "US"; // Return US if no valid payeeCountry is found
  }

  function formatData(dataObj) {
    const paymentDataArray = [];
    const vpIDs = [];
    let totalPymts = 0;
    let numberOfPymts = 0;
    for (let x = 0; x < dataObj.length; x += 1) {
      // Parse the data object
      const values = JSON.parse(dataObj[x]);
      // Extract values from the data object
      const {
        vendorPymtRecID,
        vendorEmail,
        pymtAmt,
        vendorID,
        vendorName,
        billInfoArray,
        entityPymtType,
        currSymbol,
        vendorAddress,
        returnAddress,
        isACH,
        isACHCTX,
        isCheck,
        isWire,
        bankDetObj,
        account,
        accountRN,
        accountNum,
        accBIC,
        tranID,
        tranDate,
        currencyID,
        payerType,
        vendID,
        // vendName,
        vendorAddressID,
        memo,
        chckNum,
      } = values;

      // build payment data object array
      paymentDataArray.push({
        currency: currSymbol,
        vendorID,
        entityPymtType,
        vendorAddress,
        returnAddress,
        payeeCountry: vendorAddress.payeeCountry || "US",
        country: returnAddress.returnCountry || "US",
        pymtAmt,
        vendorEmail: xmlEncode(vendorEmail),
        vendorName: xmlEncode(vendorName),
        vendorPymtRecID: xmlEncode(vendorPymtRecID),
        remittanceData: billInfoArray,
        isACH,
        isACHCTX,
        isCheck,
        isWire,
        bankDetObj,
        account,
        accountRN,
        accountNum,
        accBIC,
        tranID,
        tranDate,
        currencyID,
        payerType,
        vendID,
        // vendName,
        vendorAddressID,
        memo,
        chckNum,
      });

      // Update total and count
      totalPymts += Number(pymtAmt);
      numberOfPymts += 1;
      const index = vpIDs.indexOf(vendorPymtRecID);
      if (index === -1) {
        vpIDs.push(vendorPymtRecID);
      }
    }

    log.debug(logTitle + "paymentDataArray", paymentDataArray);

    // Group payments by entity payment type, currency, payer type, account number, country, and account BIC
    const batchedPaymentArray = auraLib.groupBy(
      paymentDataArray,
      [
        "entityPymtType",
        "currency",
        "payerType",
        "accountNum",
        "country",
        "accBIC",
      ],
      true,
    );
    const batchingObj = [];
    const isBatch = true;
    for (let x = 0; x < batchedPaymentArray.length; x += 1) {
      log.debug("batchedPaymentArray[x]", batchedPaymentArray[x]);
      let returnAddressExtract = {};
      const payeeCountryExtract =
        getFirstPayeeCountry(batchedPaymentArray[x].items) || "US";
      const bankDetailObj =
        extractFirstObject(batchedPaymentArray[x].items, "bankDetObj") || {};
      log.debug("bankDetailObj", bankDetailObj);

      try {
        returnAddressExtract =
          extractFirstObject(batchedPaymentArray[x].items, "returnAddress") ||
          {};
        log.debug("returnAddressExtract", returnAddressExtract);
      } catch (e) {
        log.error("Error extracting return address", e);
      }

      const {
        entityPymtType,
        currency,
        payerType,
        accountNum,
        country,
        accBIC,
        items,
      } = batchedPaymentArray[x];
      const batchObj = {
        batchId: "BatchRef00" + x,
        batchDate: getDateTime(isBatch),
        auraCompanyName: constants.partnerID,
        currency,
        country,
        payeeCountry: payeeCountryExtract,
        mccgCode: "950",
        entityPymtType,
        returnAddress: returnAddressExtract,
        bankDetObj: bankDetailObj,
        pymtMtd:
          entityPymtType == constants.isACH ||
          entityPymtType == constants.isWire
            ? "TRF"
            : "CHK",
        lclInstrm: entityPymtType == constants.isACH ? `${payerType}` : "CII",
        accountNum,
        BIC: accBIC == "021000021" ? "CHASUS33" : intAccBIC,
      };

      batchingObj.push({
        batchObj,
        paymentDataArray: items,
      });
    }

    // log.debug(logTitle + 'batchingObj', batchingObj);

    const headerObj = {
      jpmCallUniqueIdentifier: createIdentifier(),
      dateTime: getDateTime(),
      numberOfPymts,
      totalPymts,
      auraCompanyName: constants.partnerID,
    };

    return {
      headerObj,
      vpIDs,
      batchingObj,
    };
  }

  /**
   * Extracts the first return address from an array of payment data objects.
   *
   * @param {Array<Object>} paymentDataArray - An array of payment data objects.
   * @param {Object} paymentDataArray[].returnAddress - The return address object in a payment data object.
   * @returns {Object} The first return address found in the array, or an empty object if none is found.
   */
  function extractFirstObject(paymentDataArray, key) {
    for (const payment of paymentDataArray) {
      if (payment[key]) {
        return payment[key];
      }
    }

    return {};
  }

  /**
   * Generates a JPM payment file (encrypted and non) and save it in NetSuite.
   * @param {Array} paymentDataArray - An array of payment data objects.
   * @param {Object} headerObj - An object containing header information.
   * @param {Object} batchObj - An object containing batch information.
   * @param {string} partnerID - Partner identifier.
   * @returns {Object} - An object with error message and file ID.
   */
  function generateJPMFile(headerObj, batchingObj) {
    log.audit("generateJPMFile::constants", constants);
    let errorMessage = "";
    let fileIdXML = "";
    let fileId = "";
    const environment = JSON.stringify(runtime.envType);
    const headerXml = createFileAndGroupHeader(headerObj);
    let fullXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      ${headerXml}`;

    for (let x = 0; x < batchingObj.length; x += 1) {
      const { batchObj, paymentDataArray } = batchingObj[x];
      const batchXml = createBatchLevel(batchObj);
      const paymentXml = createPaymentLevel(paymentDataArray);
      fullXml += `${batchXml}${paymentXml}</PmtInf>`;
    }

    fullXml += `</CstmrCdtTrfInitn>
      </Document>`;
    const fileName =
      constants.partnerID +
      ".PAYMENTS.ISO20022_PAIN_01Ver3." +
      getYYYYMMDDHHMMSS(); // + '-multi';

    try {
      const fileObj = file.create({
        name: fileName,
        fileType: file.Type.XMLDOC,
        contents: fullXml,
      });

      fileObj.folder = constants.pymtFolder;
      fileIdXML = fileObj.save();
      log.audit("generateJPMFile::fileIdXML", fileIdXML);

      if (fileIdXML) {
        log.audit(logTitle + "Created XML Non-Encrypted File", fileIdXML);
        const keys = {
          ours: {
            pub: pgp.loadKeyFromSecret({
              secret: { scriptId: constants.pgpPublicSecret },
            }),
            pri: pgp.loadKeyFromSecret({
              secret: { scriptId: constants.pgpSecret },
              password: { scriptId: constants.pgpSecretPW },
            }),
          },
        };

        // let keys = {};

        // if (environment !== '"PRODUCTION"') {
        //   keys = {
        //     ours: {
        //       pub: pgp.loadKeyFromSecret({
        //         secret: { scriptId: constants.pgpPublicSecretSbx }
        //       }),
        //       pri: pgp.loadKeyFromSecret({
        //         secret: { scriptId: constants.pgpSecretSbx },
        //         password: { scriptId: constants.pgpSecretPWSbx }
        //       })
        //     }
        //   };
        // } else {
        //   keys = {
        //     ours: {
        //       pub: pgp.loadKeyFromSecret({
        //         secret: { scriptId: constants.pgpPublicSecret }
        //       }),
        //       pri: pgp.loadKeyFromSecret({
        //         secret: { scriptId: constants.pgpSecret },
        //         password: { scriptId: constants.pgpSecretPW }
        //       })
        //     }
        //   };
        // }

        log.audit("generateJPMFile::keys", keys);
        log.audit("generateJPMFile::keys.ours.pub", keys.ours.pub);
        log.audit("generateJPMFile::keys.ours.pri", keys.ours.pri);

        /* To Fully Encrypt
         */
        const data = pgp.createMessageData({
          content: fullXml,
        });

        const fullXmlEncrypted = data.encrypt({
          encryptionKeys: keys.ours.pub,
          signingKeys: keys.ours.pri,
        });
        const fileObjPGP = file.create({
          name: fileName,
          fileType: file.Type.XMLDOC,
          contents: fullXmlEncrypted.asArmored(),
        });

        /* To Sign Only.
        const signer = pgp.createSigner({
          key: keys.ours.pri,
          algorithm: certificate.HashAlg.SHA256
        });

        const signedContent = signer.sign({
          outputEncoding: encode.Encoding.BASE_64
        });

        const pgpArmoredSignature = `-----BEGIN PGP SIGNATURE-----
        ${signedContent}
        -----END PGP SIGNATURE-----`;

        log.debug(logTitle, { pgpArmoredSignature });
        const signedXml = addSignatureToXml(fullXml, pgpArmoredSignature);

        const fileObjPGP = file.create({
          name: fileName,
          fileType: file.Type.XMLDOC,
          contents: signedXml
        });
        */
        fileObjPGP.folder = constants.pymtFolderEnctypt;
        fileId = fileObjPGP.save();
        log.audit(logTitle + "Created XML Encrypted File", fileId);
      }
    } catch (e) {
      errorMessage = e;
      log.error(logTitle + "Error Signing XML Encrypted File", errorMessage);
      if (fileIdXML) {
        file.delete({
          id: fileIdXML,
        });
        log.error(logTitle + "Delete unencrypted file id", fileIdXML);
      }
    }

    return {
      errorMessage,
      fileId,
      fileName,
      fileIdXML,
    };
  }

  /**
   * Generates a BoC Payment File in XML format.
   * @param {Object} headerObj - The header data object
   * @param {Array} batchingObj - The batch objects containing payments
   * @returns {Object} - File generation details including error messages, file IDs, and file name
   */
  function generateBOCFile(headerObj, batchingObj) {
    let errorMessage = "";
    let fileIdXML = "";
    let fileId = "";
    let fileName = "";
    logTitle = "GENERATE_BOC_";

    try {
      // Generate XML Document file
      const XML_DOC = generateXML();
      createFileAndGroupHeaderBoC(XML_DOC, headerObj);

      // Generate Batch & then the corresponding Payment XML segments for each item
      log.debug(logTitle, { batchingObj });
      batchingObj.forEach(({ paymentDataArray, batchObj }) => {
        createBatchLevelBoC(XML_DOC, batchObj);
        createPaymentLevelBoC(XML_DOC, paymentDataArray);
      });

      // Construct final XML
      const fullXml = xml.Parser.toString(XML_DOC);

      log.debug({ title: logTitle + "Generated XML", details: fullXml });

      // Generate File Name
      // Aura_Inbound_YY-MM-DD-HH-mm-ss_Seq
      fileName = `Aura_Inbound_${bocGetYYYYMMDDHHMMSS()}_Seq`;

      log.debug({ title: logTitle + "File Name", details: fileName });

      // Create and Save File
      const fileObj = file.create({
        name: fileName,
        fileType: file.Type.XMLDOC,
        contents: fullXml,
        folder: constants.bocPymtFolder,
      });

      fileIdXML = fileObj.save();
      log.audit({ title: logTitle + "Saved XML File", details: fileIdXML });

      fileId = fileIdXML || "";
    } catch (error) {
      errorMessage = error.message || error;
      log.error({ title: "Error Generating BoC File", details: errorMessage });
    }

    return {
      errorMessage,
      fileId,
      fileName,
      fileIdXML,
    };
  }

  /* ----------------------------BOC BASE XML LEVEL---------------------------------------------*/

  const generateXML = () => {
    // Create <Document>
    const BASELINE_XML_TEMPLATE = "./XML_BASE_TEMPLATE.xml";
    const XML_TEMPLATE = file.load(BASELINE_XML_TEMPLATE);
    const xmlString = xml.Parser.fromString(XML_TEMPLATE.getContents());

    log.debug("Generated XML", xmlString);
    return xmlString;
  };

  /* ---------------------------JPM HEADER LEVEL---------------------------------------------*/
  /**
   * Creates XML data for the file and group header of the payment file.
   * @param {Object} headerObj - Information about the file and group header.
   * @returns {string} - XML data for the file and group header.
   */
  function createFileAndGroupHeader(headerObj) {
    try {
      logTitle = "CREATE_HEADER_";
      log.debug({ title: logTitle + "Header Object", details: headerObj });

      // Extract and validate header values
      const {
        jpmCallUniqueIdentifier = "",
        dateTime = new Date().toISOString(),
        numberOfPymts = 0,
        totalPymts = 0,
      } = headerObj || {};

      if (!jpmCallUniqueIdentifier) {
        throw new Error("Missing required JPM Call Unique Identifier.");
      }

      const xmlHeader = `
          <CstmrCdtTrfInitn>
            <GrpHdr>
              <MsgId>${jpmCallUniqueIdentifier}</MsgId>
              <CreDtTm>${dateTime}</CreDtTm>
              <NbOfTxs>${numberOfPymts}</NbOfTxs>
              <CtrlSum>${totalPymts.toFixed(2)}</CtrlSum>
              <InitgPty>
                <Nm>${constants.companyName}</Nm>
              </InitgPty>
            </GrpHdr>`;

      log.debug({ title: logTitle + "Generated XML", details: xmlHeader });
      return xmlHeader;
    } catch (error) {
      log.error({
        title: "Error Creating File and Group Header",
        details: error.message || error,
      });
      return "";
    }
  }

  /* ---------------------------BOC HEADER LEVEL---------------------------------------------*/

  function createFileAndGroupHeaderBoC(XML_DOC, headerObj) {
    try {
      logTitle = "CREATE_HEADER_";
      log.debug({ title: logTitle + "Header Object", details: headerObj });
      log.debug({ title: logTitle + "XML_DOC", details: XML_DOC });

      // Extract and validate header values
      const {
        jpmCallUniqueIdentifier = "",
        dateTime = new Date().toISOString(),
        numberOfPymts = 0,
        totalPymts = 0,
      } = headerObj || {};

      if (!jpmCallUniqueIdentifier) {
        throw new Error("Missing required JPM Call Unique Identifier.");
      }

      const grpHdr = XML_DOC.getElementsByTagName("GrpHdr")[0];
      const msgId = XML_DOC.createElementNS(namespace, "MsgId");
      const msgIdValue = XML_DOC.createTextNode(
        jpmCallUniqueIdentifier.toString(),
      );
      const creDtTm = XML_DOC.createElementNS(namespace, "CreDtTm");
      const creDtTmValue = XML_DOC.createTextNode(dateTime.toString());
      const nbOfTxs = XML_DOC.createElementNS(namespace, "NbOfTxs");
      const nbOfTxsValue = XML_DOC.createTextNode(numberOfPymts.toString());
      const ctrlSum = XML_DOC.createElementNS(namespace, "CtrlSum");
      const ctrlSumValue = XML_DOC.createTextNode(totalPymts.toFixed(2));

      msgId.appendChild(msgIdValue);
      creDtTm.appendChild(creDtTmValue);
      nbOfTxs.appendChild(nbOfTxsValue);
      ctrlSum.appendChild(ctrlSumValue);
      grpHdr.appendChild(msgId);
      grpHdr.appendChild(creDtTm);
      grpHdr.appendChild(nbOfTxs);
      grpHdr.appendChild(ctrlSum);

      // build nested child
      const initgPty = XML_DOC.createElementNS(namespace, "InitgPty");
      const nm = XML_DOC.createElementNS(namespace, "Nm");
      const nmValue = XML_DOC.createTextNode(constants.companyName.toString());

      nm.appendChild(nmValue);
      initgPty.appendChild(nm);
      grpHdr.appendChild(initgPty);

      log.debug({ title: logTitle + "Generated XML_DOC", details: XML_DOC });
      return XML_DOC;
    } catch (error) {
      log.error({
        title: "Error Creating File and Group Header",
        details: error.message || error,
      });
      return "";
    }
  }

  /* ---------------------------JPM BATCH LEVEL---------------------------------------------*/
  /**
   * Creates XML data for the batch level of the payment file.
   * @param {Object} batchInfo - Information about the payment batch.
   * @returns {string} - XML data for the batch level.
   */
  function createBatchLevel(batchInfo) {
    const {
      batchId,
      batchDate,
      // currency,
      entityPymtType,
      accountNum,
      pymtMtd,
      lclInstrm,
      BIC,
      country,
      accBIC,
    } = batchInfo;
    let xmlBL = `
          <PmtInf>
          <PmtInfId>${batchId}</PmtInfId>
          <PmtMtd>${pymtMtd}</PmtMtd>
          <PmtTpInf>`;

    if (entityPymtType == constants.isACH) {
      xmlBL += `
              <SvcLvl>
                  <Cd>NURG</Cd>
              </SvcLvl>`;
    } else if (entityPymtType != constants.isJPMCheck) {
      xmlBL += `
              <SvcLvl>
                  <Cd>URGP</Cd>
              </SvcLvl>`;
    }

    if (entityPymtType == constants.isACH) {
      xmlBL += `
              <LclInstrm>
                <Cd>${lclInstrm}</Cd>
              </LclInstrm>`;
    } else if (entityPymtType == constants.isJPMCheck) {
      xmlBL += `
      <LclInstrm>
        <Prtry>${lclInstrm}</Prtry>
      </LclInstrm>`;
    }

    if (entityPymtType == constants.isACH) {
      xmlBL += `
              <CtgyPurp>
               <Prtry>ACCTVERIFY</Prtry> 
              </CtgyPurp>`;
    }

    xmlBL += `
            </PmtTpInf>
            <ReqdExctnDt>${batchDate}</ReqdExctnDt>
            <Dbtr>
              <Nm>${constants.companyName}</Nm>
              <PstlAdr>
                <Ctry>${country}</Ctry>
              </PstlAdr>`;

    if (entityPymtType == constants.isACH) {
      xmlBL += `
              <Id>
                <OrgId>
                  <Othr>
                    <Id>${constants.achDebitorAcc}</Id> 
                    <SchmeNm>
                      <Prtry>JPMCOID</Prtry>
                    </SchmeNm>
                  </Othr>
                </OrgId>
              </Id>`;
    }

    if (constants.isJPMDeployment) {
      xmlBL += `
            </Dbtr>
            <DbtrAcct>
                <Id>
                   <Othr>
                     <Id>${accountNum}</Id>
                  </Othr>
                </Id>
                <Tp>
                    <Prtry>Yes</Prtry>
                </Tp>
                <Ccy>USD</Ccy>
            </DbtrAcct>
            <DbtrAgt>
                <FinInstnId>
                    <BIC>${BIC}</BIC>`;
    } else if (constants.isBoCDeployment) {
      xmlBL += `
      </Dbtr>
      <DbtrAcct>
          <Id>
             <Othr>
               <Id>${accountNum}</Id>
            </Othr>
          </Id>
          <Tp>
              <Prtry>Yes</Prtry>
          </Tp>
          <Ccy>USD</Ccy>
      </DbtrAcct>
      <DbtrAgt>
          <FinInstnId>`;
    }

    if (
      entityPymtType == constants.isACH ||
      entityPymtType == constants.isJPMCheck
    ) {
      xmlBL += `
              <ClrSysMmbId>
                  <MmbId>${accBIC}</MmbId>
              </ClrSysMmbId>`;
    }

    xmlBL += `
              <PstlAdr>
                <Ctry>${country}</Ctry>
              </PstlAdr>
            </FinInstnId>
          </DbtrAgt>`;
    return xmlBL;
  }

  /* ---------------------------BOC BATCH LEVEL START---------------------------------------------*/
  /**
   * @param {Object} headerObj - Information about the file and group header.
   * @returns {string} - XML data for the file and group header.
   */

  function createBatchLevelBoC(XML_DOC, batchInfo) {
    try {
      logTitle = "CREATE_BATCH_BOC_";
      log.debug({ title: logTitle + "Batch Info", details: batchInfo });

      const {
        batchId,
        batchDate,
        entityPymtType,
        accountNum,
        pymtMtd,
        lclInstrm,
        returnAddress,
        country,
        payeeCountry,
        BIC,
        // accBIC
      } = batchInfo;

      const cstmrCdtTrfInitn =
        XML_DOC.getElementsByTagName("CstmrCdtTrfInitn")[0];
      const pmtInf = XML_DOC.getElementsByTagName("PmtInf")[0];
      const pmtInfId = XML_DOC.createElementNS(namespace, "PmtInfId");
      const pmtInfIdValue = XML_DOC.createTextNode(batchId.toString());
      const pmtMtd = XML_DOC.createElementNS(namespace, "PmtMtd");
      const pmtMtdValue = XML_DOC.createTextNode(pymtMtd.toString());
      const PmtTpInf = XML_DOC.createElementNS(namespace, "PmtTpInf");
      cstmrCdtTrfInitn.appendChild(pmtInf);
      pmtMtd.appendChild(pmtMtdValue);
      pmtInfId.appendChild(pmtInfIdValue);
      pmtInf.appendChild(pmtMtd);
      pmtInf.appendChild(pmtInfId);
      pmtInf.appendChild(PmtTpInf);

      getServiceLevel(XML_DOC, entityPymtType, lclInstrm);

      const reqdExctnDt = XML_DOC.createElementNS(namespace, "ReqdExctnDt");
      const reqdExctnDtValue = XML_DOC.createTextNode(batchDate.toString());
      reqdExctnDt.appendChild(reqdExctnDtValue);
      pmtInf.appendChild(reqdExctnDt);

      // debit section
      // dbtr table
      const dbtr = XML_DOC.getElementsByTagName("Dbtr")[0];
      const nm = XML_DOC.createElementNS(namespace, "Nm");
      const nmValue = XML_DOC.createTextNode(constants.companyName.toString());

      nm.appendChild(nmValue);
      dbtr.appendChild(nm);

      getDebtorAddress(XML_DOC, entityPymtType, returnAddress, country);
      getACHDebtorId(XML_DOC, entityPymtType);

      pmtInf.appendChild(dbtr);

      getDebtorAccount(XML_DOC, accountNum);
      getDebtorAgent(XML_DOC, entityPymtType, country, BIC, payeeCountry);
      return XML_DOC;
    } catch (error) {
      log.error({
        title: "Error Creating Batch XML",
        details: error.message || error,
      });
      return "";
    }
  }

  /**
   * Generates Service Level XML
   * @param {string} entityPymtType
   * @param {string} lclInstrm
   * @returns {string}
   */
  function getServiceLevel(XML_DOC, entityPymtType, lclInstrm) {
    const PmtTpInf = XML_DOC.getElementsByTagName("PmtTpInf")[0];
    const svcLvl = XML_DOC.createElementNS(namespace, "SvcLvl");
    const cd = XML_DOC.createElementNS(namespace, "Cd");
    const cdRawValue =
      entityPymtType === constants.isACH ||
      entityPymtType === constants.isJPMCheck
        ? "NURG"
        : "URGP";
    const cdValue = XML_DOC.createTextNode(cdRawValue.toString());

    // Append elements to the XML document
    cd.appendChild(cdValue);
    svcLvl.appendChild(cd);

    // Append the elements to the PmtTpInf element
    PmtTpInf.appendChild(svcLvl);

    const lclInstrmElement = XML_DOC.createElementNS(namespace, "LclInstrm");
    const lclInstrmValue = XML_DOC.createTextNode(lclInstrm.toString());

    if (
      entityPymtType === constants.isACH ||
      entityPymtType === constants.isJPMCheck
    ) {
      lclInstrmElement.appendChild(lclInstrmValue);
      PmtTpInf.appendChild(lclInstrmElement);
    }

    if (entityPymtType === constants.isACH) {
      const ctgyPurp = XML_DOC.createElementNS(namespace, "CtgyPurp");
      const prtry = XML_DOC.createElementNS(namespace, "Prtry");
      const prtryValue = XML_DOC.createTextNode("ACCTVERIFY");

      prtry.appendChild(prtryValue);
      ctgyPurp.appendChild(prtry);
      PmtTpInf.appendChild(ctgyPurp);
    }

    return XML_DOC;
  }

  /**
   * Generates XML for debtor address based on payment type
   * @param {string} entityPymtType
   * @param {Object} returnAddress
   * @param {string} country
   * @returns {string}
   */
  function getDebtorAddress(XML_DOC, entityPymtType, returnAddress, country) {
    const dbtr = XML_DOC.getElementsByTagName("Dbtr")[0];
    const pstlAdr = XML_DOC.createElementNS(namespace, "PstlAdr");
    const ctry = XML_DOC.createElementNS(namespace, "Ctry");
    let ctryValue = XML_DOC.createTextNode(country.toString());

    if (entityPymtType === constants.isJPMCheck) {
      const { returnCity, returnState, returnAdd1, returnZip, returnCountry } =
        returnAddress;

      const adrLine = XML_DOC.createElementNS(namespace, "AdrLine");
      const adrLineValue = XML_DOC.createTextNode(returnAdd1.toString());
      const pstCd = XML_DOC.createElementNS(namespace, "PstCD");
      const pstCdValue = XML_DOC.createTextNode(returnZip.toString());
      const twnNm = XML_DOC.createElementNS(namespace, "TwnNm");
      const twnNmValue = XML_DOC.createTextNode(returnCity.toString());
      const ctrySubDvsn = XML_DOC.createElementNS(namespace, "CtrySubDvsn");
      const ctrySubDvsnValue = XML_DOC.createTextNode(returnState.toString());
      ctryValue = XML_DOC.createTextNode(returnCountry.toString());

      adrLine.appendChild(adrLineValue);
      pstCd.appendChild(pstCdValue);
      twnNm.appendChild(twnNmValue);
      ctrySubDvsn.appendChild(ctrySubDvsnValue);
      ctry.appendChild(ctryValue);

      pstlAdr.appendChild(adrLine);
      pstlAdr.appendChild(pstCd);
      pstlAdr.appendChild(twnNm);
      pstlAdr.appendChild(ctrySubDvsn);
      pstlAdr.appendChild(ctry);
    }

    ctry.appendChild(ctryValue);
    pstlAdr.appendChild(ctry);
    dbtr.appendChild(pstlAdr);
    return pstlAdr;
  }

  /**
   * Generates XML for ACH debtor ID
   * @param {string} entityPymtType
   * @returns {string}
   */
  function getACHDebtorId(XML_DOC, entityPymtType) {
    const dbtr = XML_DOC.getElementsByTagName("Dbtr")[0];
    if (entityPymtType === constants.isACH) {
      const orgIdParent = XML_DOC.createElementNS(namespace, "Id");
      const orgId = XML_DOC.createElementNS(namespace, "OrgId");
      const orgIdOthr = XML_DOC.createElementNS(namespace, "Othr");
      const orgIdChild = XML_DOC.createElementNS(namespace, "Id");
      const orgIdChildValue = XML_DOC.createTextNode(
        constants.achBOCId.toString(),
      );
      const orgIdSchmeNm = XML_DOC.createElementNS(namespace, "SchmeNm");
      const orgIdSchmeNmCd = XML_DOC.createElementNS(namespace, "Prtry");
      const orgIdSchmeNmCdValue = XML_DOC.createTextNode("JPMCOID");

      orgIdChild.appendChild(orgIdChildValue);
      orgIdSchmeNmCd.appendChild(orgIdSchmeNmCdValue);
      orgIdSchmeNm.appendChild(orgIdSchmeNmCd);
      orgIdOthr.appendChild(orgIdChild);
      orgIdOthr.appendChild(orgIdSchmeNm);
      orgId.appendChild(orgIdOthr);
      orgIdParent.appendChild(orgId);
      dbtr.appendChild(orgIdParent);
    }

    return XML_DOC;
  }

  /**
   * Generates XML for debtor account
   * @param {string} accountNum
   * @returns {string}
   */
  function getDebtorAccount(XML_DOC, accountNum) {
    const pmtInf = XML_DOC.getElementsByTagName("PmtInf")[0];
    const dbtrAcct = XML_DOC.createElementNS(namespace, "DbtrAcct");
    const id = XML_DOC.createElementNS(namespace, "Id");
    const othr = XML_DOC.createElementNS(namespace, "Othr");
    const id2 = XML_DOC.createElementNS(namespace, "Id");
    const id2Value = XML_DOC.createTextNode(accountNum.toString());
    // tp, party and yes value
    const tp = XML_DOC.createElementNS(namespace, "Tp");
    const prtry = XML_DOC.createElementNS(namespace, "Prtry");
    const prtryValue = XML_DOC.createTextNode("Yes");
    const ccy = XML_DOC.createElementNS(namespace, "Ccy");
    const ccyValue = XML_DOC.createTextNode("USD");

    id2.appendChild(id2Value);
    ccy.appendChild(ccyValue);
    prtry.appendChild(prtryValue);
    othr.appendChild(id2);
    id.appendChild(othr);
    dbtrAcct.appendChild(id);
    tp.appendChild(prtry);
    dbtrAcct.appendChild(tp);
    dbtrAcct.appendChild(ccy);
    pmtInf.appendChild(dbtrAcct);
    return XML_DOC;
  }

  /**
   * Generates XML for debtor agent
   * @param {string} entityPymtType
   * @param {string} country
   * @param {string} accBIC
   * @returns {string}
   */
  function getDebtorAgent(
    XML_DOC,
    entityPymtType,
    country,
    accBIC,
    payeeCountry,
  ) {
    log.debug({
      title: "Debtor Agent Information",
      details: {
        entityPymtType,
        country,
        payeeCountry,
        accBIC,
      },
    });

    const pmtInf = XML_DOC.getElementsByTagName("PmtInf")[0];
    const dbtrAgt = XML_DOC.createElementNS(namespace, "DbtrAgt");
    const finInstnId = XML_DOC.createElementNS(namespace, "FinInstnId");
    const clrSysMmbId = XML_DOC.createElementNS(namespace, "ClrSysMmbId");
    const mmbId = XML_DOC.createElementNS(namespace, "MmbId");
    const mmbIdValue = XML_DOC.createTextNode(
      constants.achBOCRoutingNumber.toString(),
    );
    // PstlAdr and Ctry
    const pstlAdr = XML_DOC.createElementNS(namespace, "PstlAdr");
    const ctry = XML_DOC.createElementNS(namespace, "Ctry");
    const ctryValue = XML_DOC.createTextNode(country.toString());

    mmbId.appendChild(mmbIdValue);
    clrSysMmbId.appendChild(mmbId);
    ctry.appendChild(ctryValue);
    pstlAdr.appendChild(ctry);

    finInstnId.appendChild(clrSysMmbId);
    finInstnId.appendChild(pstlAdr);
    dbtrAgt.appendChild(finInstnId);
    pmtInf.appendChild(dbtrAgt);

    return xml;
  }

  /* ---------------------------BOC BATCH LEVEL END---------------------------------------------*/

  /* ---------------------------JPM PAYMENT LEVEL---------------------------------------------*/
  /**
   * Creates XML data for the payment level of the payment file.
   * @param {Array} paymentDataArray - An array of payment data objects.
   * @returns {string} - XML data for the payment level.
   */
  function createPaymentLevel(paymentDataArray) {
    return paymentDataArray
      .map((paymentData) => {
        const {
          vendorPymtRecID,
          currency,
          pymtAmt,
          vendorName,
          vendorEmail,
          remittanceData,
          // vendorID,
          isACH = false,
          isACHCTX,
          isCheck,
          isWire,
          tranID,
          bankDetObj = {},
          vendorAddress = {},
          chckNum,
        } = paymentData;

        const remittanceXml = generateRemittanceXML(remittanceData, isACHCTX);
        // log.debug('remittanceXml', remittanceXml);
        const bankCountry = bankDetObj.bankCountry
          ? bankDetObj.bankCountry
          : vendorAddress.payeeCountry;

        const cdtrAgtXml =
          isACH || isWire
            ? `
          <CdtrAgt>
            <FinInstnId>
              ${bankDetObj && bankDetObj.bankBIC ? `<BIC>${bankDetObj.bankBIC}</BIC>` : ""}
              ${bankDetObj && bankDetObj.bankName ? `<Nm>${bankDetObj.bankName}</Nm>` : ""}
              
              ${
                bankDetObj && bankDetObj.branchNo
                  ? `<ClrSysMmbId>
                                                      <MmbId>${bankDetObj.branchNo}</MmbId>
                                                     </ClrSysMmbId>`
                  : ""
              }
              <PstlAdr>
                ${[
                  vendorAddress && vendorAddress.payeeCity
                    ? `<TwnNm>${vendorAddress.payeeCity}</TwnNm>`
                    : "",
                  vendorAddress && vendorAddress.payeeState
                    ? `<CtrySubDvsn>${vendorAddress.payeeState}</CtrySubDvsn>`
                    : "",
                  bankCountry ? `<Ctry>${bankCountry}</Ctry>` : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
              </PstlAdr>
            </FinInstnId>
          </CdtrAgt>`
                .split("\n")
                .filter((line) => line.trim() !== "")
                .join("\n")
            : "";

        const cdtrAcct =
          isACH || isWire
            ? [
                "<CdtrAcct>",
                "<Id>",
                // eslint-disable-next-line no-nested-ternary
                bankDetObj && bankDetObj.bankIBAN
                  ? `<IBAN>${bankDetObj.bankIBAN}</IBAN>`
                  : bankDetObj && bankDetObj.bankAcc
                    ? `<Othr>\n<Id>${bankDetObj.bankAcc}</Id>\n</Othr>`
                    : "",
                "</Id>",
                "<Tp>",
                `<Cd>${bankDetObj && bankDetObj.cdtrAcctType ? bankDetObj.cdtrAcctType : ""}</Cd>`,
                "</Tp>",
                "</CdtrAcct>",
              ]
                .filter((line) => line.trim() !== "")
                .join("\n")
            : "";

        const ChqInstr = isCheck
          ? `
          <ChqInstr>
            <ChqNb>${chckNum || ""}</ChqNb>
          </ChqInstr>`
          : "";

        const contactDetailsXml = vendorEmail
          ? `
            <CtctDtls>
              <EmailAdr>${vendorEmail}</EmailAdr>
            </CtctDtls>`
          : "";

        const cdtr = `
          <Cdtr>
            <Nm>${vendorName}</Nm>
            <PstlAdr>
            ${[
              vendorAddress && vendorAddress.payeeAdd1
                ? `<AdrLine>${vendorAddress.payeeAdd1}</AdrLine>`
                : "",
              vendorAddress && vendorAddress.payeeCity
                ? `<AdrLine>${vendorAddress.payeeCity}, ${vendorAddress.payeeState}</AdrLine>`
                : "",
              vendorAddress && vendorAddress.payeeCountry
                ? `<AdrLine>${vendorAddress.payeeCountry}</AdrLine>`
                : "",
            ]
              .filter(Boolean)
              .join("\n")}
            </PstlAdr>
            ${contactDetailsXml}
          </Cdtr>`;
        return `
          <CdtTrfTxInf>
              <PmtId>
                  <InstrId>${tranID}</InstrId>
                  <EndToEndId>${vendorPymtRecID}</EndToEndId>
              </PmtId>
              <Amt>
                  <InstdAmt Ccy="${currency}">${pymtAmt.toFixed(2)}</InstdAmt>
              </Amt>
            ${[cdtrAgtXml, ChqInstr, cdtr, cdtrAcct].filter(Boolean).join("\n")}
              <RmtInf>
                  ${remittanceXml}
              </RmtInf>
          </CdtTrfTxInf>`;
      })
      .join("\n");
  }

  /* ---------------------------BOC PAYMENT LEVEL START---------------------------------------------*/
  /**
   * Generates a payment level Bank of Canada (BoC) XML structure for an array of payment data.
   *
   * @param {Array<Object>} paymentDataArray - An array of payment data objects.
   * @returns {string} - A string containing the generated XML structure for the payment data.
   */
  function createPaymentLevelBoC(XML_DOC, paymentDataArray) {
    try {
      return (
        paymentDataArray
          // add an index to generatePaymentXml
          .map((paymentData, index) =>
            generatePaymentXml(XML_DOC, paymentData, index),
          )
      );
    } catch (error) {
      log.error({
        title: "Error Creating Payment XML",
        details: error.message || error,
      });
      return "";
    }
  }

  /**
   * Generates XML for a single payment transaction.
   * @param {Object} paymentData - Payment data object.
   * @returns {string} - XML string for the payment.
   */
  function generatePaymentXml(XML_DOC, paymentData, index) {
    const {
      vendorPymtRecID = "",
      currency = "USD",
      pymtAmt = "0.00",
      vendorName = "",
      vendorEmail = "",
      remittanceData = "",
      isACH = false,
      isACHCTX = false,
      isCheck = false,
      isWire = false,
      tranID = "",
      bankDetObj = {},
      vendorAddress = {},
      chckNum = "",
    } = paymentData;

    log.debug("generatePaymentXml", { index, paymentData });

    const cdtTrfTxInf = XML_DOC.createElementNS(namespace, "CdtTrfTxInf");
    const indexLevel = XML_DOC.getElementsByTagName("PmtInf").length;
    const cdtTrfTxInfIndex = indexLevel > 0 ? indexLevel - 1 : 0;
    const pmtInf = XML_DOC.getElementsByTagName("PmtInf")[cdtTrfTxInfIndex];

    // Append the CdtTrfTxInf element to the XML document
    pmtInf.appendChild(cdtTrfTxInf);
    const bankCountry =
      bankDetObj.bankCountry || vendorAddress.payeeCountry || "";
    const pmtId = XML_DOC.createElementNS(namespace, "PmtId");
    const instrId = XML_DOC.createElementNS(namespace, "InstrId");
    const instrIdValue = XML_DOC.createTextNode(tranID.toString());
    const endToEndId = XML_DOC.createElementNS(namespace, "EndToEndId");
    const endToEndIdValue = XML_DOC.createTextNode(vendorPymtRecID.toString());
    const amt = XML_DOC.createElementNS(namespace, "Amt");
    const instdAmt = XML_DOC.createElementNS(namespace, "InstdAmt");
    const instdAmtValue = XML_DOC.createTextNode(pymtAmt.toFixed(2));
    const ccy = XML_DOC.createAttribute("Ccy");
    ccy.value = currency;
    instdAmt.setAttributeNode(ccy);
    instdAmt.appendChild(instdAmtValue);
    amt.appendChild(instdAmt);
    // cdtTrfTxInf.appendChild(amt);
    pmtId.appendChild(instrId);
    instrId.appendChild(instrIdValue);
    pmtId.appendChild(endToEndId);
    endToEndId.appendChild(endToEndIdValue);
    cdtTrfTxInf.appendChild(pmtId);
    cdtTrfTxInf.appendChild(amt);
    getCreditorAgentXml(
      XML_DOC,
      isACH,
      isWire,
      bankDetObj,
      vendorAddress,
      bankCountry,
      index,
    );
    getCheckInstructionsXml(XML_DOC, isCheck, chckNum, index);
    getCreditorXml(XML_DOC, vendorName, vendorEmail, vendorAddress, index);
    getCreditorAccountXml(XML_DOC, isACH, isWire, bankDetObj, index);
    generateRemittanceXMLBOC(XML_DOC, remittanceData, isACHCTX, index);

    return XML_DOC;
  }

  /**
   * Generates XML for the creditor agent (Bank details).
   * @param {boolean} isACH
   * @param {boolean} isWire
   * @param {Object} bankDetObj
   * @param {Object} vendorAddress
   * @param {string} bankCountry
   * @returns {string}
   */
  const getCreditorAgentXml = (
    XML_DOC,
    isACH,
    isWire,
    bankDetObj = {},
    vendorAddress = {},
    bankCountry = "",
    index,
  ) => {
    if (!isWire && !isACH) return "";

    const cdtTrfTxInf = XML_DOC.getElementsByTagName("CdtTrfTxInf")[index];
    const isInternationalWire = isWire && bankCountry && bankCountry !== "US";

    const { payeeCity = "", payeeState = "" } = vendorAddress;
    const { bankBIC, bankAdd1, bankAdd2, bankName, branchNo } = bankDetObj;

    if (isInternationalWire) {
      const { mmbId, pstCD, twnNm, ctrySubDvsn, ctry, adrLine } =
        constants.intWireIntermediaryBankInformation;

      // intermediary agent information
      const IntrmyAgt1 = XML_DOC.createElementNS(namespace, "IntrmyAgt1");
      const FinInstnId = XML_DOC.createElementNS(namespace, "FinInstnId");
      const ClrSysMmbId = XML_DOC.createElementNS(namespace, "ClrSysMmbId");
      const MmbId = XML_DOC.createElementNS(namespace, "MmbId");
      const mmbIdValueRaw = constants.intWireBOCRoutingNumber || mmbId;
      const MmbIdValue = XML_DOC.createTextNode(mmbIdValueRaw.toString());
      const PstlAdr = XML_DOC.createElementNS(namespace, "PstlAdr");
      const PstCD = XML_DOC.createElementNS(namespace, "PstCD");
      const PstCDValue = XML_DOC.createTextNode(pstCD.toString());
      const TwnNm = XML_DOC.createElementNS(namespace, "TwnNm");
      const TwnNmValue = XML_DOC.createTextNode(twnNm.toString());
      const CtrySubDvsn = XML_DOC.createElementNS(namespace, "CtrySubDvsn");
      const CtrySubDvsnValue = XML_DOC.createTextNode(ctrySubDvsn.toString());
      const Ctry = XML_DOC.createElementNS(namespace, "Ctry");
      const CtryValue = XML_DOC.createTextNode(ctry.toString());
      const AdrLine = XML_DOC.createElementNS(namespace, "AdrLine");
      const AdrLineValue = XML_DOC.createTextNode(adrLine.toString());

      // Append elements
      MmbId.appendChild(MmbIdValue);
      PstCD.appendChild(PstCDValue);
      TwnNm.appendChild(TwnNmValue);
      CtrySubDvsn.appendChild(CtrySubDvsnValue);
      Ctry.appendChild(CtryValue);
      AdrLine.appendChild(AdrLineValue);
      ClrSysMmbId.appendChild(MmbId);
      PstlAdr.appendChild(PstCD);
      PstlAdr.appendChild(TwnNm);
      PstlAdr.appendChild(CtrySubDvsn);
      PstlAdr.appendChild(Ctry);
      PstlAdr.appendChild(AdrLine);
      FinInstnId.appendChild(ClrSysMmbId);
      FinInstnId.appendChild(PstlAdr);
      IntrmyAgt1.appendChild(FinInstnId);
      cdtTrfTxInf.appendChild(IntrmyAgt1);

      // beneficiary information
      const CdtrAgt = XML_DOC.createElementNS(namespace, "CdtrAgt");
      const FinInstnId2 = XML_DOC.createElementNS(namespace, "FinInstnId");
      const PstlAdr2 = XML_DOC.createElementNS(namespace, "PstlAdr");
      const BIC = XML_DOC.createElementNS(namespace, "BIC");
      const BICValue = XML_DOC.createTextNode(bankBIC.toString());
      const AdrLine2 = XML_DOC.createElementNS(namespace, "AdrLine");
      const AdrLineValue2 = XML_DOC.createTextNode(bankAdd1.toString());
      const PstCD2 = XML_DOC.createElementNS(namespace, "PstCD");
      const PstCDValue2 = XML_DOC.createTextNode(bankAdd2.toString());
      const TwnNm2 = XML_DOC.createElementNS(namespace, "TwnNm");
      const TwnNmValue2 = XML_DOC.createTextNode(payeeCity.toString());
      const CtrySubDvsn2 = XML_DOC.createElementNS(namespace, "CtrySubDvsn");
      const CtrySubDvsnValue2 = XML_DOC.createTextNode(payeeState.toString());
      const Ctry2 = XML_DOC.createElementNS(namespace, "Ctry");
      const CtryValue2 = XML_DOC.createTextNode(bankCountry);

      // Append elements
      BIC.appendChild(BICValue);
      AdrLine2.appendChild(AdrLineValue2);
      PstCD2.appendChild(PstCDValue2);
      TwnNm2.appendChild(TwnNmValue2);
      CtrySubDvsn2.appendChild(CtrySubDvsnValue2);
      Ctry2.appendChild(CtryValue2);

      CdtrAgt.appendChild(FinInstnId2);
      FinInstnId2.appendChild(BIC);
      FinInstnId2.appendChild(PstlAdr2);
      PstlAdr2.appendChild(AdrLine2);
      PstlAdr2.appendChild(PstCD2);
      PstlAdr2.appendChild(TwnNm2);
      PstlAdr2.appendChild(CtrySubDvsn2);
      PstlAdr2.appendChild(Ctry2);
      cdtTrfTxInf.appendChild(CdtrAgt);

      return XML_DOC;
    }

    // domestic wire or ACH
    // creditor agent information
    const CdtrAgt = XML_DOC.createElementNS(namespace, "CdtrAgt");
    const FinInstnId = XML_DOC.createElementNS(namespace, "FinInstnId");
    const Nm = XML_DOC.createElementNS(namespace, "Nm");
    const bankNameRaw = bankName || bankBIC;
    const NmValue = XML_DOC.createTextNode(bankNameRaw.toString());
    const ClrSysMmbId = XML_DOC.createElementNS(namespace, "ClrSysMmbId");
    const MmbId = XML_DOC.createElementNS(namespace, "MmbId");
    const MmbIdValue = XML_DOC.createTextNode(branchNo.toString());
    const PstlAdr = XML_DOC.createElementNS(namespace, "PstlAdr");
    const TwnNm = XML_DOC.createElementNS(namespace, "TwnNm");
    const TwnNmValue = XML_DOC.createTextNode(payeeCity.toString());
    const CtrySubDvsn = XML_DOC.createElementNS(namespace, "CtrySubDvsn");
    const CtrySubDvsnValue = XML_DOC.createTextNode(payeeState.toString());
    const Ctry = XML_DOC.createElementNS(namespace, "Ctry");
    const CtryValue = XML_DOC.createTextNode(bankCountry.toString());

    // Append elements
    Nm.appendChild(NmValue);
    MmbId.appendChild(MmbIdValue);
    TwnNm.appendChild(TwnNmValue);
    CtrySubDvsn.appendChild(CtrySubDvsnValue);
    Ctry.appendChild(CtryValue);
    ClrSysMmbId.appendChild(MmbId);
    PstlAdr.appendChild(TwnNm);
    PstlAdr.appendChild(CtrySubDvsn);
    PstlAdr.appendChild(Ctry);
    FinInstnId.appendChild(Nm);
    FinInstnId.appendChild(ClrSysMmbId);
    FinInstnId.appendChild(PstlAdr);
    CdtrAgt.appendChild(FinInstnId);
    cdtTrfTxInf.appendChild(CdtrAgt);

    return XML_DOC;
  };

  /**
   * Generates XML for creditor account details.
   * @param {boolean} isACH
   * @param {boolean} isWire
   * @param {Object} bankDetObj
   * @returns {string}
   */
  function getCreditorAccountXml(XML_DOC, isACH, isWire, bankDetObj, index) {
    if (!isACH && !isWire) return "";

    const cdtTrfTxInf = XML_DOC.getElementsByTagName("CdtTrfTxInf")[index];
    const cdtrAcct = XML_DOC.createElementNS(namespace, "CdtrAcct");
    const id = XML_DOC.createElementNS(namespace, "Id");
    // iban
    // const iban = XML_DOC.createElementNS(namespace, 'IBAN');
    // const ibanValue = XML_DOC.createTextNode(bankDetObj.bankIBAN || '');
    // other
    const bankUse = bankDetObj.bankIBAN
      ? bankDetObj.bankIBAN
      : bankDetObj.bankAcc;
    const othr = XML_DOC.createElementNS(namespace, "Othr");
    const id2 = XML_DOC.createElementNS(namespace, "Id");
    const id2Value = XML_DOC.createTextNode(bankUse || "");
    // type
    const tp = XML_DOC.createElementNS(namespace, "Tp");
    const cd = XML_DOC.createElementNS(namespace, "Cd");
    const cdValue = XML_DOC.createTextNode(bankDetObj.cdtrAcctType || "");

    // append elements
    // iban.appendChild(ibanValue);
    id2.appendChild(id2Value);
    cd.appendChild(cdValue);
    tp.appendChild(cd);
    othr.appendChild(id2);
    // id.appendChild(iban);
    id.appendChild(othr);
    cdtrAcct.appendChild(id);
    cdtrAcct.appendChild(tp);
    cdtTrfTxInf.appendChild(cdtrAcct);
    log.debug({ title: "Creditor Account XML", details: cdtTrfTxInf });

    return XML_DOC;
  }

  /**
   * Generates XML for check instructions.
   * @param {boolean} isCheck
   * @param {string} chckNum
   * @returns {string}
   */
  function getCheckInstructionsXml(XML_DOC, isCheck, chckNum, index) {
    if (!isCheck) return "";

    const cdtTrfTxInf = XML_DOC.getElementsByTagName("CdtTrfTxInf")[index];
    const chqInstr = XML_DOC.createElementNS(namespace, "ChqInstr");
    const chqNb = XML_DOC.createElementNS(namespace, "ChqNb");
    const chqNbValue = XML_DOC.createTextNode(chckNum);
    chqNb.appendChild(chqNbValue);
    chqInstr.appendChild(chqNb);
    cdtTrfTxInf.appendChild(chqInstr);

    return XML_DOC;
  }

  /**
   * Generates XML for creditor (Vendor) details.
   * @param {string} vendorName
   * @param {string} vendorEmail
   * @param {Object} vendorAddress
   * @returns {string}
   */
  function getCreditorXml(
    XML_DOC,
    vendorName,
    vendorEmail,
    vendorAddress,
    index,
  ) {
    const cdtTrfTxInf = XML_DOC.getElementsByTagName("CdtTrfTxInf")[index];
    const cdtr = XML_DOC.createElementNS(namespace, "Cdtr");
    const nm = XML_DOC.createElementNS(namespace, "Nm");
    const nmValue = XML_DOC.createTextNode(vendorName);
    const pstlAdr = XML_DOC.createElementNS(namespace, "PstlAdr");
    const pstCd = XML_DOC.createElementNS(namespace, "PstCD");
    const pstCdValue = XML_DOC.createTextNode(vendorAddress.payeeZip);
    const adrLine = XML_DOC.createElementNS(namespace, "AdrLine");
    const adrLineValue = XML_DOC.createTextNode(vendorAddress.payeeAdd1);
    const twnNm = XML_DOC.createElementNS(namespace, "TwnNm");
    const twnNmValue = XML_DOC.createTextNode(vendorAddress.payeeCity);
    const ctrySubDvsn = XML_DOC.createElementNS(namespace, "CtrySubDvsn");
    const ctrySubDvsnValue = XML_DOC.createTextNode(vendorAddress.payeeState);
    const ctry = XML_DOC.createElementNS(namespace, "Ctry");
    const ctryValue = XML_DOC.createTextNode(vendorAddress.payeeCountry);
    const ctctDtls = XML_DOC.createElementNS(namespace, "CtctDtls");
    const emailAdr = XML_DOC.createElementNS(namespace, "EmailAdr");
    const emailAdrValue = XML_DOC.createTextNode(vendorEmail);

    nm.appendChild(nmValue);
    adrLine.appendChild(adrLineValue);
    pstCd.appendChild(pstCdValue);
    twnNm.appendChild(twnNmValue);
    ctrySubDvsn.appendChild(ctrySubDvsnValue);
    ctry.appendChild(ctryValue);
    emailAdr.appendChild(emailAdrValue);
    cdtr.appendChild(nm);
    cdtr.appendChild(pstlAdr);
    cdtr.appendChild(ctctDtls);
    pstlAdr.appendChild(adrLine);
    pstlAdr.appendChild(twnNm);
    pstlAdr.appendChild(ctrySubDvsn);
    pstlAdr.appendChild(ctry);
    pstlAdr.appendChild(pstCd);
    ctctDtls.appendChild(emailAdr);
    cdtTrfTxInf.appendChild(cdtr);

    return XML_DOC;
  }

  /* ---------------------------BOC PAYMENT LEVEL END---------------------------------------------*/

  /**
   * Retrieves billing information for a specific vendor payment record.
   * @param {number} vendorPymtRecID - Vendor payment record ID.
   * @returns {Array} - An array of billing information.
   */
  function getBillInfoArray(vendorPymtRecID, currencyID, currSymbol) {
    const vpRemittanceInfo = [];
    const billIDsToSearch = [];
    const vendorpaymentSearchObj = search.create({
      type: "vendorpayment",
      filters: [
        ["type", "anyof", "VendPymt"],
        "AND",
        ["mainline", "is", "F"],
        "AND",
        ["internalid", "anyof", vendorPymtRecID],
      ],
      columns: [
        search.createColumn({
          name: "appliedtotransaction",
          label: "Applied To Transaction",
        }),
        search.createColumn({
          name: "tranid",
          join: "appliedToTransaction",
          label: "Document Number",
        }),
        search.createColumn({
          name: "internalid",
          join: "appliedToTransaction",
          label: "Document Number",
        }),
        search.createColumn({
          name: "transactionname",
          join: "appliedToTransaction",
          label: "Transaction Name",
        }),
        search.createColumn({
          name: "amount",
          join: "appliedToTransaction",
          label: "Amount",
        }),
        search.createColumn({
          name: "trandate",
          join: "appliedToTransaction",
          label: "Transaction Date",
        }),
        search.createColumn({
          name: "tranid",
          join: "appliedToTransaction",
          label: "Transaction ID",
        }),
        search.createColumn({
          name: "currency",
          join: "appliedToTransaction",
          label: "Currency",
        }),
      ],
    });
    const itemArrData = auraLib.getAllSearchResults(
      vendorpaymentSearchObj.run(),
    );
    itemArrData.forEach((result) => {
      let billCurrSymbol = currSymbol;
      const tranID =
        result.getText({
          name: "appliedtotransaction",
        }) || "";
      const billID =
        result.getValue({
          name: "internalid",
          join: "appliedToTransaction",
        }) || "";
      let billGrossAmt =
        result.getValue({
          name: "amount",
          join: "appliedToTransaction",
        }) || 0;
      const billDiscAmt =
        result.getValue({
          name: "termsdiscountamount",
          join: "appliedToTransaction",
        }) || 0;
      let billAmt = parseFloat(billGrossAmt) - parseFloat(billDiscAmt);
      const billDate =
        result.getValue({
          name: "trandate",
          join: "appliedToTransaction",
        }) || "";
      const billCurrency =
        result.getValue({
          name: "currency",
          join: "appliedToTransaction",
        }) || "";
      if (billID && billAmt && billDate) {
        const index = billIDsToSearch.indexOf(billID);
        if (index < 0) {
          if (billCurrency != currencyID) {
            billCurrSymbol = "";
            billIDsToSearch.push(billID);
          }

          // const remitInfo = tranID + ', Bill Amount: $' + billAmt;
          const dateToUse = formatDate(billDate);
          if (billAmt < 1.0) {
            billAmt = parseFloat(billAmt);
          }

          if (billGrossAmt < 1.0) {
            billGrossAmt = parseFloat(billGrossAmt);
          }

          vpRemittanceInfo.push({
            currency: billCurrSymbol,
            currencyID: billCurrency,
            dueAmount: billGrossAmt,
            remittedAmount: billAmt ? parseFloat(billAmt).toFixed(2) : "0.00",
            billNumber: tranID,
            billID,
            type: "CINV",
            discountAmount: billDiscAmt
              ? parseFloat(billDiscAmt).toFixed(2)
              : "0.00",
            relatedDate: dateToUse,
            unstructuredInfo:
              extractValue(tranID, "Bill #") + "-" + billGrossAmt,
          });
        }
      }
    });

    if (billIDsToSearch.length > 0) {
      getCurrencySymbols(vpRemittanceInfo, billIDsToSearch);
    }

    return vpRemittanceInfo;
  }

  /**
   * Generates a formatted date and time string.
   * @param {boolean} isBatch - Indicates if the date and time are for a batch.
   * @returns {string} - Formatted date and time string.
   */
  function getDateTime(isBatch) {
    const currentDate = new Date();
    let formattedDate = "";
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");
    const hours = String(currentDate.getHours()).padStart(2, "0");
    const minutes = String(currentDate.getMinutes()).padStart(2, "0");
    const seconds = String(currentDate.getSeconds()).padStart(2, "0");
    if (isBatch) {
      formattedDate = `${year}-${month}-${day}`;
    } else {
      formattedDate = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    return formattedDate;
  }

  /**
   * Creates a unique identifier for the payment file.
   * @returns {string} - Unique identifier.
   */
  function createIdentifier() {
    let identifier = "AuracoPayment";
    identifier += "-" + getYYYYMMDDHHMMSS();

    return xmlEncode(identifier);
  }

  /**
   * Encodes XML-special characters within a string.
   * @param {string} value - The string to be encoded.
   * @returns {string} - Encoded string.
   */
  function xmlEncode(value) {
    return value.replace(/[<>&"']/g, (match) => {
      switch (match) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        case '"':
          return "&quot;";
        case "'":
          return "&apos;";
        default:
          return match;
      }
    });
  }

  /**
   * Gets the current date and time in YYYYMMDDHHMMSS format.
   * @returns {string} - Formatted date and time string.
   */
  function getYYYYMMDDHHMMSS() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const formattedDateTime = `${year}${month}${day}${hours}${minutes}${seconds}`;
    return formattedDateTime;
  }

  function bocGetYYYYMMDDHHMMSS() {
    const now = new Date();
    const year = String(now.getFullYear()).slice(2, 4);
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const formattedDateTime = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
    return formattedDateTime;
  }

  /**
   * Updates a vendor payment record in NetSuite with Chase file information.
   * @param {number} vpID - Vendor payment record ID.
   * @param {string} chaseFile - Chase payment file data.
   */
  function updateVP(vpID, jpmPymtFile, fileName) {
    return record.submitFields
      .promise({
        type: "vendorpayment",
        id: vpID,
        values: {
          [tranfields.jpmPymtFile]: jpmPymtFile,
          [tranfields.jpmPymtFileName]: fileName,
          [tranfields.jpmError]: "",
          [tranfields.jpmPymtStatus]: constants.jpmSent,
        },
        options: {
          ignoreMandatoryFields: true,
        },
      })
      .then((updatedRecordId) => {
        log.audit("Updated Record:", updatedRecordId);
        return updatedRecordId;
      })
      .catch((reason) => {
        log.error("Payment Rec Update Error", reason);
        throw reason;
      });
  }

  function generateRemittanceXML(records, isACHCTX) {
    let xmlString = "";

    let isFirstInstance = true;

    if (isACHCTX) {
      records.forEach((instance) => {
        if (isFirstInstance) {
          xmlString += "<Strd>\n";
          isFirstInstance = false;
        } else {
          xmlString += "                    <Strd>\n";
        }

        xmlString += "                      <RfrdDocInf>\n";
        xmlString += "                        <Tp>\n";
        xmlString += "                          <CdOrPrtry>\n";
        xmlString += `                            <Cd>${instance.type}</Cd>\n`;
        xmlString += "                          </CdOrPrtry>\n";
        xmlString += "                        </Tp>\n";
        xmlString += `                        <Nb>${instance.billNumber}</Nb>\n`;
        xmlString += `                        <RltdDt>${instance.relatedDate}</RltdDt>\n`;
        xmlString += "                      </RfrdDocInf>\n";

        xmlString += "                      <RfrdDocAmt>\n";
        xmlString += `                        <DuePyblAmt Ccy="${instance.currency}">${instance.dueAmount}</DuePyblAmt>\n`;
        xmlString += `                        <DscntApldAmt Ccy="${instance.currency}">${instance.discountAmount}</DscntApldAmt>\n`;
        xmlString += `                        <RmtdAmt Ccy="${instance.currency}">${instance.remittedAmount}</RmtdAmt>\n`;
        xmlString += "                      </RfrdDocAmt>\n";
        xmlString += "                    </Strd>\n";
      });
    } else {
      log.debug("generateRemittanceXML::records", records);

      let mergedInfo = records
        .map((instance) => instance.unstructuredInfo || "")
        .filter((info) => info.trim() !== "")
        .map((ele) => xmlEncode(ele))
        .join(" ");

      log.debug("generateRemittanceXML::beforeParse::mergedInfo", mergedInfo);

      mergedInfo = parseStringEndingInXmlEncodedValue(mergedInfo);
      log.debug("generateRemittanceXML::afterParse::mergedInfo", mergedInfo);

      xmlString += `<Ustrd>${mergedInfo}</Ustrd>`;
    }

    return xmlString;
  }

  /**
   * If the string does not end with an xml escaped character, the function slices the string to be a max length of 71
   * If the string ends with an xml escaped character, the function removes the ending xml escaped string
   * This is to address the edge case if the xml escaped character is at the end of the string and is cut off by the 71 character max for the Ustrd tag.
   * This error case was reported by Rich DeMarco (Aura) to Alison Cain (JPM) on May 28, 2025
   * @param {string} str
   * @returns {string}
   */
  function parseStringEndingInXmlEncodedValue(str) {
    log.debug("parseStringEndingInXmlEncodedValue-input::str", str);
    log.debug(
      "parseStringEndingInXmlEncodedValue-input::str.length",
      str.length,
    );

    const USTRD_LIMIT_LENGTH = 71;
    const LESS_THAN_XML_STRING = "&lt;"; // length 4
    const GREATER_THAN_XML_STRING = "&gt;"; // length 4
    const AMPERSAND_XML_STRING = "&amp;"; // length 5
    const QUOTE_XML_STRING = "&quot;"; // length 6
    const APOS_XML_STRING = "&apos;"; // length 6

    // if the string is less than 71, return string
    if (str.length <= USTRD_LIMIT_LENGTH) {
      return str;
    }

    // set new string to be current string in case the string does not end with xml string
    let newStr = str.slice();

    // if the string ends with an xml escaped string, remove the ending string with the appropriate ending length
    // in while loop, remove the last value to lower the limit under 71 length
    // remove one character at a time from the end of the string due to an edge case that the string is spliced in the middle of another xml escaped character

    while (newStr.length > USTRD_LIMIT_LENGTH) {
      if (newStr.endsWith(LESS_THAN_XML_STRING)) {
        newStr = newStr.slice(0, newStr.length - LESS_THAN_XML_STRING.length);
      } else if (newStr.endsWith(GREATER_THAN_XML_STRING)) {
        newStr = newStr.slice(
          0,
          newStr.length - GREATER_THAN_XML_STRING.length,
        );
      } else if (newStr.endsWith(AMPERSAND_XML_STRING)) {
        newStr = newStr.slice(0, newStr.length - AMPERSAND_XML_STRING.length);
      } else if (newStr.endsWith(QUOTE_XML_STRING)) {
        newStr = newStr.slice(0, newStr.length - QUOTE_XML_STRING.length);
      } else if (newStr.endsWith(APOS_XML_STRING)) {
        newStr = newStr.slice(0, newStr.length - APOS_XML_STRING.length);
      } else {
        newStr = newStr.slice(0, newStr.length - 1);
      }
    }

    log.debug("parseStringEndingInXmlEncodedValue-output::newStr", newStr);
    log.debug(
      "parseStringEndingInXmlEncodedValue-output::newStr.length",
      newStr.length,
    );

    return newStr;
  }

  function generateRemittanceXMLBOC(XML_DOC, records, isACHCTX, index) {
    log.debug("generateRemittanceXMLBOC::XML_DOC", XML_DOC);
    log.debug("generateRemittanceXMLBOC::records", records);
    log.debug("generateRemittanceXMLBOC::isACHCTX", isACHCTX);
    log.debug("generateRemittanceXMLBOC::index", index);

    const parentNode = XML_DOC.createElementNS(namespace, "RmtInf");
    const cdtTrfTxInf = XML_DOC.getElementsByTagName("CdtTrfTxInf")[index];
    // if (isACHCTX) {
    records.forEach((instance, instanceIdx) => {
      log.debug(`generateRemittanceXMLBOC::instance::${instanceIdx}`, instance);

      const strd = XML_DOC.createElementNS(namespace, "Strd");
      const rfrdDocInf = XML_DOC.createElementNS(namespace, "RfrdDocInf");
      const tp = XML_DOC.createElementNS(namespace, "Tp");
      const cdOrPrtry = XML_DOC.createElementNS(namespace, "CdOrPrtry");
      const cd = XML_DOC.createElementNS(namespace, "Cd");
      cd.appendChild(XML_DOC.createTextNode(instance.type.toString()));
      cdOrPrtry.appendChild(cd);
      tp.appendChild(cdOrPrtry);
      rfrdDocInf.appendChild(tp);

      const nb = XML_DOC.createElementNS(namespace, "Nb");
      nb.appendChild(XML_DOC.createTextNode(instance.billNumber.toString()));
      rfrdDocInf.appendChild(nb);

      const rltdDt = XML_DOC.createElementNS(namespace, "RltdDt");
      rltdDt.appendChild(
        XML_DOC.createTextNode(instance.relatedDate.toString()),
      );
      rfrdDocInf.appendChild(rltdDt);

      // append to strd
      strd.appendChild(rfrdDocInf);

      const rfrdDocAmt = XML_DOC.createElementNS(namespace, "RfrdDocAmt");

      const dueAmt = XML_DOC.createElementNS(namespace, "DuePyblAmt");
      const dueAmtValue = XML_DOC.createTextNode(instance.dueAmount.toString());
      dueAmt.setAttribute({ name: "Ccy", value: instance.currency });
      dueAmt.appendChild(dueAmtValue);
      rfrdDocAmt.appendChild(dueAmt);

      const dscntAmt = XML_DOC.createElementNS(namespace, "DscntApldAmt");
      const dscntAmtValue = XML_DOC.createTextNode(
        instance.discountAmount.toString(),
      );
      dscntAmt.setAttribute({ name: "Ccy", value: instance.currency });
      dscntAmt.appendChild(dscntAmtValue);
      rfrdDocAmt.appendChild(dscntAmt);

      // error
      const rmtdAmt = XML_DOC.createElementNS(namespace, "RmtdAmt");
      const rmtdAmtValue = XML_DOC.createTextNode(
        instance.remittedAmount.toString(),
      );
      rmtdAmt.setAttribute({ name: "Ccy", value: instance.currency });
      rmtdAmt.appendChild(rmtdAmtValue);
      rfrdDocAmt.appendChild(rmtdAmt);

      // append to strd
      strd.appendChild(rfrdDocAmt);

      parentNode.appendChild(strd);
    });
    // } else {

    // ustrd tag is optional. for multiple lines, if there is one ustrd value, it repeats for all lines.
    // memo is optional is does not need to be put into the check file. memo field shows on the check printout memo line. length needs to be short to not overflow
    // alexandra borgos confirmed on june 11, 2025 that ustrd and memo tag does not need to be put into boc check file

    // log.debug('generateRemittanceXMLBOC::records', records);
    // let mergedInfo = records
    //   .map((instance) => instance.unstructuredInfo || '')
    //   .filter((info) => info.trim() !== '')
    //   .map((ele) => xmlEncode(ele))
    //   .join(' ');
    // log.debug('generateRemittanceXMLBOC::beforeParse::mergedInfo', mergedInfo);

    // mergedInfo = parseStringEndingInXmlEncodedValue(mergedInfo);
    // log.debug('generateRemittanceXMLBOC::afterParse::mergedInfo', mergedInfo);

    // const ustrd = XML_DOC.createElementNS(namespace, 'Ustrd');
    // const ustrdValue = XML_DOC.createTextNode(mergedInfo.toString());
    // ustrd.appendChild(ustrdValue);
    // parentNode.appendChild(ustrd);
    // }

    cdtTrfTxInf.appendChild(parentNode);
    return XML_DOC;
  }

  /**
   * Formats a given date to 'YYYY-MM-DD' format.
   *
   * @param {Date} date - The date to be formatted.
   * @returns {string} The formatted date in 'YYYY-MM-DD' format.
   */
  function formatDate(date) {
    const result = new Date(date);
    const month = (result.getMonth() + 1).toString().padStart(2, "0");
    const day = result.getDate().toString().padStart(2, "0");
    const year = result.getFullYear();

    return `${year}-${month}-${day}`;
  }

  /**
   * Retrieves billing information for a specific vendor payment record.
   * @param {number} vendorPymtRecID - Vendor payment record ID.
   * @returns {Array} - An array of billing information.
   */
  function getBankDetails(vendor) {
    const bankDetails = {};
    const vendorpaymentSearchObj = search.create({
      type: "vendor",
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        [
          "custrecord_2663_parent_vendor.custrecord_2663_entity_bank_type",
          "anyof",
          "1",
        ],
        "AND",
        ["internalid", "anyof", vendor],
      ],
      columns: [
        search.createColumn({ name: "entityid", label: "ID" }),
        // search.createColumn({ name: 'altname', label: 'Name' }),
        search.createColumn({ name: "email", label: "Email" }),
        search.createColumn({ name: "phone", label: "Phone" }),
        search.createColumn({ name: "internalid", label: "Internal ID" }),
        search.createColumn({
          name: "custrecord_2663_entity_address1",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Address1",
        }),

        search.createColumn({
          name: "custrecord_2663_entity_address2",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Address2",
        }),

        search.createColumn({
          name: "custrecord_2663_entity_acct_no",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Bank Account Number",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bank_acct_type",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Bank Account Type",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bank_code",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Bank Code",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bank_no",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Bank Number",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bank_name",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Bank Name",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bank_type",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Type",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_bic",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "BIC",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_country_code",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Country Code",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_iban",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "IBAN",
        }),
        search.createColumn({
          name: "custrecord_2663_entity_swift",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
          label: "Swift code",
        }),
      ],
    });
    const itemArrData = auraLib.getAllSearchResults(
      vendorpaymentSearchObj.run(),
    );
    itemArrData.forEach((result) => {
      const bankAcc =
        result.getValue({
          name: "custrecord_2663_entity_acct_no",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
        }) || "";
      const branchNo =
        result.getValue({
          name: "custrecord_2663_entity_bank_no",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
        }) || "";
      const bankAccType =
        result.getValue({
          name: "custrecord_2663_entity_bank_acct_type",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
        }) || "";

      const bankBIC =
        result.getValue({
          name: "custrecord_2663_entity_bic",
          join: "CUSTRECORD_2663_PARENT_VENDOR",
        }) || "";
      const accType = bankAccType == "1" ? "CASH" : "SVGS";

      if (bankAcc && (branchNo || bankBIC)) {
        bankDetails.bankAcc = bankAcc;
        bankDetails.branchNo = branchNo;
        bankDetails.bankBIC = bankBIC;
        bankDetails.bankAccType = bankAccType;
        bankDetails.cdtrAcctType = accType;
        bankDetails.bankCTEmail =
          result.getValue({
            name: "email",
          }) || "";
        bankDetails.bankCTPhone =
          result.getValue({
            name: "phone",
          }) || "";
        bankDetails.bankAdd1 =
          result.getValue({
            name: "custrecord_2663_entity_address1",
            join: "CUSTRECORD_2663_PARENT_VENDOR",
          }) || "";

        bankDetails.bankAdd2 =
          result.getValue({
            name: "custrecord_2663_entity_address2",
            join: "CUSTRECORD_2663_PARENT_VENDOR",
          }) || "";

        bankDetails.bankName =
          result.getValue({
            name: "custrecord_2663_entity_bank_name",
            join: "CUSTRECORD_2663_PARENT_VENDOR",
          }) || "";
        bankDetails.bankCountry =
          result.getValue({
            name: "custrecord_2663_entity_country_code",
            join: "CUSTRECORD_2663_PARENT_VENDOR",
          }) || "";
        bankDetails.bankIBAN =
          result.getValue({
            name: "custrecord_2663_entity_iban",
            join: "CUSTRECORD_2663_PARENT_VENDOR",
          }) || "";
      }
    });

    return bankDetails;
  }

  /**
   * Extracts the content following "Purchase Order #" from the provided string.
   * If "Purchase Order #" is not found, returns the original string.
   *
   * @param {string} inputString - The input string to check and extract from.
   * @returns {string} - The extracted purchase order or the original string if "Purchase Order #" is not found.
   */
  function extractValue(inputString, searchPhrase) {
    const index = inputString.indexOf(searchPhrase);

    if (index !== -1) {
      return inputString.substring(index + searchPhrase.length).trim();
    }

    return inputString;
  }

  /**
   * Establishes an SFTP connection and uploads a file to a specified directory.
   *
   * @param {string} fileId - The ID of the file to be uploaded.
   * @param {string} fileName - The name of the file to be uploaded.
   * @returns {boolean} - Returns `true` if the file was uploaded successfully, otherwise `false`.
   */
  function connectSFTP(fileId, fileName) {
    let uploaded = "";
    try {
      const environment = JSON.stringify(runtime.envType);
      log.debug("connectSFTP::environment", environment);
      log.debug("connectSFTP::runtime.envType", runtime.envType);
      const { isJPMDeployment, isBoCDeployment } = constants;
      log.debug("connectSFTP::constants", constants);

      const {
        username,
        hostKey,
        hostKeySBx,
        inboundDirectory,
        sftpKey,
        sftpKeySbx,
        hostURL,
        sftpKeyBoCSbx,
        sftpKeyBoC,
        hostKeyBoC,
        hostKeyBocSBx,
        usernameBoC,
        hostURLBoC,
        prodBoCPaymentFolder,
        uatBoCPaymentFolder,
      } = constants;
      let url;
      let keyId;
      const port = 22;
      let hostKeyUse;
      let sftpUsername;
      let sftpDirectory;

      // prod setup for jpm
      if (runtime.envType == runtime.EnvType.PRODUCTION && isJPMDeployment) {
        log.debug(
          "connectSFTP runtime.envType == runtime.EnvType.PRODUCTION && isJPMDeployment",
          runtime.envType == runtime.EnvType.PRODUCTION && isJPMDeployment,
        );
        url = hostURL;
        keyId = sftpKey;
        hostKeyUse = hostKey;
        sftpUsername = username;
        sftpDirectory = inboundDirectory;
      }

      // sbx setup for jpm
      if (runtime.envType == runtime.EnvType.SANDBOX && isJPMDeployment) {
        log.debug(
          "connectSFTP runtime.envType == runtime.EnvType.SANDBOX && isJPMDeployment",
          runtime.envType == runtime.EnvType.SANDBOX && isJPMDeployment,
        );

        url = "transmissions-uat.jpmorgan.com";
        keyId = sftpKeySbx;
        hostKeyUse = hostKeySBx;
        sftpUsername = username;
        sftpDirectory = inboundDirectory;
      }

      // prod setup for boc
      if (runtime.envType == runtime.EnvType.PRODUCTION && isBoCDeployment) {
        log.debug(
          "connectSFTP runtime.envType == runtime.EnvType.PRODUCTION && isBoCDeployment",
          runtime.envType == runtime.EnvType.PRODUCTION && isBoCDeployment,
        );

        url = hostURLBoC;

        keyId = sftpKeyBoC;
        hostKeyUse = hostKeyBoC;
        sftpUsername = usernameBoC;
        // sftpDirectory = prodBoCPaymentFolder;
        sftpDirectory =
          "/Distribution/AURA_sa/BancofCalifornia/IntPay/PROD/ToFIS";
      }

      // sbx setup for box
      // BoC does not have a sandbox environment. however, use the uat folder instead on the prod sftp for BoC testing.
      if (runtime.envType == runtime.EnvType.SANDBOX && isBoCDeployment) {
        log.debug(
          "connectSFTP runtime.envType == runtime.EnvType.SANDBOX && isBoCDeployment",
          runtime.envType == runtime.EnvType.SANDBOX && isBoCDeployment,
        );
        url = hostURLBoC;
        keyId = sftpKeyBoC; // use prod key
        hostKeyUse = hostKeyBoC; // use prod host key
        // keyId = sftpKeyBoCSbx;
        // hostKeyUse = hostKeyBocSBx;
        sftpUsername = usernameBoC;
        // sftpDirectory = uatBoCPaymentFolder;
        sftpDirectory =
          "/Distribution/AURA_sa/BancofCalifornia/IntPay/UAT/ToFIS";
      }

      log.audit(logTitle, {
        username: sftpUsername,
        keyId,
        url,
        port,
        hostKey: hostKeyUse,
        fileName,
        fileId,
        sftpDirectory,
      });

      const createConnectionObj = {
        username: sftpUsername,
        keyId,
        url,
        port,
        hostKey: hostKeyUse,
      };

      log.audit("connectSFTP::createConnectionObj", createConnectionObj);

      const connection = sftp.createConnection(createConnectionObj);
      log.audit(logTitle + "SFTP Connection", connection);

      viewFiles(connection, sftpDirectory);

      connection.upload({
        directory: sftpDirectory,
        filename: fileName,
        file: file.load(fileId),
        replaceExisting: true,
      });
      uploaded = true;
      log.audit(logTitle + "SFTP Connection", connection);

      viewFiles(connection, sftpDirectory);
    } catch (err) {
      log.error("connectSFTP::err", err);
      log.audit(logTitle + "Error During SFTP Connection", err.message);
    }

    return uploaded;
  }

  function viewFiles(connection, viewPath) {
    const directoryFilesArr = connection.list({ path: viewPath });

    log.audit("viewFiles::directoryFilesArr", directoryFilesArr);
    log.audit("viewFiles::directoryFilesArr.length", directoryFilesArr.length);

    for (let i = 0; i < directoryFilesArr.length; i += 1) {
      const fileObj = directoryFilesArr[i];
      const { name } = fileObj;

      log.audit(`viewFiles::name::${i}`, name);
    }
  }

  /**
   * Retrieves currency symbols for a given set of bill IDs and updates the provided remittance info array.
   *
   * @param {Object[]} vpRemittanceInfo - The array containing remittance information.
   * @param {string[]} billIDsToSearch - The array of bill internal IDs to search for.
   */
  function getCurrencySymbols(vpRemittanceInfo, billIDsToSearch) {
    const itemExclusiveSearch = search.create({
      type: "transaction",
      filters: [
        ["internalid", "anyof", billIDsToSearch],
        "AND",
        ["mainline", "is", "T"],
      ],
      columns: [
        search.createColumn({ name: "internalid", label: "Internal ID" }),
        search.createColumn({ name: "currency", label: "Currency" }),
        search.createColumn({
          name: "symbol",
          join: "Currency",
          label: "Symbol",
        }),
      ],
    });

    const itemArrData = auraLib.getAllSearchResults(itemExclusiveSearch.run());
    itemArrData.forEach((result) => {
      const internalid =
        result.getValue({
          name: "internalid",
        }) || "";
      const billSymbol =
        result.getValue({
          name: "symbol",
          join: "Currency",
        }) || "";
      if (internalid) {
        const matchingIndexes = auraLib.findIndexesByProperty(
          vpRemittanceInfo,
          "billID",
          internalid.toString(),
        );
        for (let x = 0; x < matchingIndexes.length; x += 1) {
          const index = matchingIndexes[x];
          // eslint-disable-next-line no-param-reassign
          vpRemittanceInfo[index].currency = billSymbol;
        }
      }
    });
  }

  // eslint-disable-next-line no-unused-vars
  function addSignatureToXml(xmlContent, pgpSignature) {
    return xmlContent.replace(
      "</Document>",
      `
      <Signature>
        ${pgpSignature}
      </Signature>
    </Document>`,
    );
  }

  function formatError(message) {
    return `<b><font color="red">${message}</font></b>`;
  }

  /**
   * Retrieves bank details if the vendor payment is ACH or Wire.
   * @param {Object} entityDetails - The entity details object.
   * @returns {Object} - Bank details object.
   */
  function getBankDetailsIfNeeded(entityDetails) {
    return entityDetails.vendorID &&
      (entityDetails.isACH || entityDetails.isWire)
      ? getBankDetails(entityDetails.vendorID)
      : {};
  }

  /**
   * Checks if bank details are valid.
   * @param {Object} bankDetObj - The bank details object.
   * @returns {boolean} - Returns true if bank details are valid, otherwise false.
   */
  function isValidBankDetails(bankDetObj) {
    return (
      bankDetObj.bankAcc &&
      (bankDetObj.branchNo || bankDetObj.bankBIC) &&
      bankDetObj.cdtrAcctType
    );
  }

  /**
   * Builds the value object to be passed to the reduce stage.
   * @param {string} vendorPymtRecID - The vendor payment record ID.
   * @param {Object} entityDetails - Entity-related payment details.
   * @param {Object} vendorAddress - Vendor address details.
   * @param {Object} returnAddress - Return address details.
   * @param {Object} bankDetObj - Bank details object.
   * @param {Object} accountDetails - Account details object.
   * @returns {Object} - Returns an object containing all necessary payment details.
   */
  function buildValueObject(
    vendorPymtRecID,
    entityDetails,
    vendorAddress,
    returnAddress,
    bankDetObj,
    accountDetails,
  ) {
    return {
      vendorPymtRecID,
      vendorEmail: entityDetails.isEmployee
        ? entityDetails.employeeEmail
        : entityDetails.vendorEmail,
      pymtAmt: entityDetails.pymtAmt,
      vendorID: entityDetails.vendorID,
      vendID: entityDetails.isEmployee
        ? entityDetails.employeeID
        : entityDetails.vendID,
      // vendName: entityDetails.isEmployee ? entityDetails.vendorName : entityDetails.vendName,
      vendorName: entityDetails.vendorName,
      vendorAddressID: vendorAddress.vendorAddressID,
      memo: entityDetails.memo,
      vendorAddress,
      returnAddress,
      billInfoArray: getBillInfoArray(
        vendorPymtRecID,
        entityDetails.currencyID,
        entityDetails.currSymbol,
      ),
      isACH: entityDetails.isACH,
      isCheck: entityDetails.isCheck,
      isWire: entityDetails.isWire,
      entityPymtType: entityDetails.entityPymtType,
      bankDetObj,
      account: entityDetails.account,
      accountRN: accountDetails.accountRN,
      accountNum: accountDetails.accountNum,
      accBIC: accountDetails.accBIC,
      tranID: entityDetails.tranID,
      tranDate: entityDetails.tranDate,
      currSymbol: entityDetails.currSymbol,
      currencyID: entityDetails.currencyID,
      payerType: entityDetails.payerType,
      chckNum: entityDetails.chckNum,
    };
  }

  // eslint-disable-next-line no-unused-vars
  function decrypt(inputValues) {
    const CURRENT_SCRIPT = runtime.getCurrentScript();
    const DEST_FOLDER = CURRENT_SCRIPT.getParameter({
      name: "custscript_mhi_beadsmith_citi_folder",
    });
    const PRIV_KEY = CURRENT_SCRIPT.getParameter({
      name: "custscript_mhi_beadsmith_private_key",
    });
    const PRIVATE_KEY_PW = CURRENT_SCRIPT.getParameter({
      name: "custscript_mhi_beadsmith_password",
    });
    const CITI_KEY_1 = CURRENT_SCRIPT.getParameter({
      name: "custscript_mhi_beadsmith_pub_key_1",
    });
    const CITI_KEY_2 = CURRENT_SCRIPT.getParameter({
      name: "custscript_mhi_beadsmith_public_key_2",
    });

    log.debug("input vals", inputValues);
    log.debug("PUBLIC_KEY1", PRIV_KEY);
    log.debug("DEST_FOLDER", DEST_FOLDER);

    const keys = {
      ours: {
        pub1: pgp.loadKeyFromSecret({
          secret: { scriptId: CITI_KEY_1 },
        }),
        pub2: pgp.loadKeyFromSecret({
          secret: { scriptId: CITI_KEY_2 },
        }),
        pri: pgp.loadKeyFromSecret({
          secret: { scriptId: PRIV_KEY },
          password: { scriptId: PRIVATE_KEY_PW },
        }),
      },
    };

    const { fileID, fileName } = inputValues;
    const fileObj = file.load({
      id: fileID,
    });

    const fileContent = fileObj.getContents();
    log.debug("fileContent", fileContent);

    const binaryPgpFile = encode.convert({
      string: fileContent,
      inputEncoding: encode.Encoding.BASE_64,
      outputEncoding: encode.Encoding.UTF_8,
    });

    const binaryParseMessage = pgp.parseMessage({
      value: binaryPgpFile,
    });

    log.debug("binaryParseMessage", binaryParseMessage);

    const binaryMsgData = binaryParseMessage.decrypt({
      decryptionKeys: keys.ours.pri, // beadsmith private
      verificationKeys: [keys.ours.pub1, keys.ours.pub2], // citibank public
    });
    log.debug("binaryMsgData", binaryMsgData);

    const decryptedBinContent = binaryMsgData.getText();
    //   log.debug('decryptedBinContent', decryptedBinContent);
    log.debug("decryptedBinContent2", decryptedBinContent);

    const decryptedFile = file.create({
      name: fileName,
      fileType: file.Type.PLAINTEXT,
      contents: decryptedBinContent,
      folder: DEST_FOLDER, // Specify the folder where the file should be uploaded
    });
    const newFileId = decryptedFile.save();

    log.debug("Decrypted File Saved", "File ID: " + newFileId);

    return newFileId;
  }

  // // ** DO NOT EDIT OR DELETE ** MHI | JPMC File Generation Search V2
  // function archiveJpmSearch() {
  //   const vendorpaymentSearchObj = search.create({
  //     type: "vendorpayment",
  //     settings: [{ name: "consolidationtype", value: "ACCTTYPE" }],
  //     filters:
  //     [
  //       ["type", "anyof", "VendPymt"],
  //       "AND",
  //       ["custbody_mhi_payment_status", "anyof", "2"],
  //       "AND",
  //       ["custbody_mhi_payment_type", "anyof", "8", "9", "2"],
  //       "AND",
  //       ["mainline", "is", "T"],
  //       "AND",
  //       ["status", "noneof", "VendPymt:E", "VendPymt:V", "VendPymt:D"],
  //       "AND",
  //       ["accountmain", "anyof", "856", "1128", "1118", "863", "1133", "864", "865", "868", "867", "869", "870", "1136", "871", "872"]
  //     ],
  //     columns:
  //     [
  //       search.createColumn({ name: "entity", label: "Name" }),
  //       search.createColumn({ name: "trandate", label: "Date" }),
  //       search.createColumn({ name: "custbody_mhi_payment_type", label: "Payment Method" }),
  //       search.createColumn({ name: "custbody_mhi_payment_status", label: "JPMC File Transfer Status" }),
  //       search.createColumn({ name: "custbody_mhi_jpm_error", label: "JPMC File Transfer Error" }),
  //       search.createColumn({ name: "memo", label: "Memo" }),
  //       search.createColumn({ name: "account", label: "Account" }),
  //       search.createColumn({ name: "amount", label: "Amount" }),
  //       search.createColumn({ name: "fxamount", label: "Amount (Foreign Currency)" }),
  //       search.createColumn({
  //         name: "email",
  //         join: "vendor",
  //         label: "Email"
  //       }),
  //       search.createColumn({
  //         name: "internalid",
  //         join: "vendor",
  //         label: "Internal ID"
  //       }),
  //       search.createColumn({
  //         name: "altname",
  //         join: "vendor",
  //         label: "Name"
  //       }),
  //       search.createColumn({
  //         name: "entityid",
  //         join: "vendor",
  //         label: "ID"
  //       }),
  //       search.createColumn({
  //         name: "isperson",
  //         join: "vendor",
  //         label: "Is Individual"
  //       }),
  //       search.createColumn({
  //         name: "email",
  //         join: "employee",
  //         label: "Email"
  //       }),
  //       search.createColumn({
  //         name: "entityid",
  //         join: "employee",
  //         label: "ID"
  //       }),
  //       search.createColumn({
  //         name: "internalid",
  //         join: "employee",
  //         label: "Internal ID"
  //       }),
  //       search.createColumn({
  //         name: "altname",
  //         join: "employee",
  //         label: "Name"
  //       }),
  //       search.createColumn({ name: "currency", label: "Currency" }),
  //       search.createColumn({
  //         name: "symbol",
  //         join: "Currency",
  //         label: "Symbol"
  //       }),
  //       search.createColumn({ name: "transactionname", label: "Transaction Name" }),
  //       search.createColumn({ name: "transactionnumber", label: "Transaction Number" }),
  //       search.createColumn({ name: "tranid", label: "Document Number" }),
  //       search.createColumn({ name: "subsidiary", label: "Subsidiary" }),
  //       search.createColumn({
  //         name: "country",
  //         join: "subsidiary",
  //         label: "Country"
  //       }),
  //       search.createColumn({
  //         name: "address1",
  //         join: "subsidiary",
  //         label: "Address 1"
  //       }),
  //       search.createColumn({
  //         name: "address2",
  //         join: "subsidiary",
  //         label: "Address 2"
  //       }),
  //       search.createColumn({
  //         name: "city",
  //         join: "subsidiary",
  //         label: "City"
  //       }),
  //       search.createColumn({
  //         name: "state",
  //         join: "subsidiary",
  //         label: "State/Province"
  //       }),
  //       search.createColumn({
  //         name: "zip",
  //         join: "subsidiary",
  //         label: "Zip"
  //       }),
  //       search.createColumn({ name: "custbody_mhi_jpmc_isofilename", label: "JPM Linked File Name" }),
  //       search.createColumn({ name: "custbody_mhi_jpmc_isofile", label: "Linked JPMC File" })
  //     ]
  //   });
  //   const searchResultCount = vendorpaymentSearchObj.runPaged().count;
  //   log.debug("vendorpaymentSearchObj result count", searchResultCount);
  //   vendorpaymentSearchObj.run().each((result) =>
  //     // .run().each has a limit of 4,000 results
  //     true);

  //   /*
  //  vendorpaymentSearchObj.id="customsearch1750440191337";
  //  vendorpaymentSearchObj.title="** DO NOT EDIT OR DELETE ** MHI | JPMC File Generation Search V2 (copy)";
  //  var newSearchId = vendorpaymentSearchObj.save();
  //  */
  // }

  // // ** DO NOT EDIT OR DELETE ** MHI | BoC File Generation Search V2
  // function archiveBocSearch() {
  //   const vendorpaymentSearchObj = search.create({
  //     type: "vendorpayment",
  //     settings: [{ name: "consolidationtype", value: "ACCTTYPE" }],
  //     filters:
  //     [
  //       ["type", "anyof", "VendPymt"],
  //       "AND",
  //       ["custbody_mhi_payment_status", "anyof", "2"],
  //       "AND",
  //       ["custbody_mhi_payment_type", "anyof", "8", "2", "9"],
  //       "AND",
  //       ["mainline", "is", "T"],
  //       "AND",
  //       ["status", "noneof", "VendPymt:E", "VendPymt:V", "VendPymt:D"],
  //       "AND",
  //       ["accountmain", "anyof", "1138", "1139", "1140", "1141", "1142", "1143"],
  //       "AND",
  //       ["currency", "anyof", "1"]
  //     ],
  //     columns:
  //     [
  //       search.createColumn({ name: "entity", label: "Name" }),
  //       search.createColumn({ name: "trandate", label: "Date" }),
  //       search.createColumn({ name: "custbody_mhi_payment_type", label: "Payment Method" }),
  //       search.createColumn({ name: "custbody_mhi_payment_status", label: "JPMC File Transfer Status" }),
  //       search.createColumn({ name: "custbody_mhi_jpm_error", label: "JPMC File Transfer Error" }),
  //       search.createColumn({ name: "memo", label: "Memo" }),
  //       search.createColumn({ name: "account", label: "Account" }),
  //       search.createColumn({ name: "amount", label: "Amount" }),
  //       search.createColumn({ name: "fxamount", label: "Amount (Foreign Currency)" }),
  //       search.createColumn({
  //         name: "email",
  //         join: "vendor",
  //         label: "Email"
  //       }),
  //       search.createColumn({
  //         name: "internalid",
  //         join: "vendor",
  //         label: "Internal ID"
  //       }),
  //       search.createColumn({
  //         name: "altname",
  //         join: "vendor",
  //         label: "Name"
  //       }),
  //       search.createColumn({
  //         name: "entityid",
  //         join: "vendor",
  //         label: "ID"
  //       }),
  //       search.createColumn({
  //         name: "isperson",
  //         join: "vendor",
  //         label: "Is Individual"
  //       }),
  //       search.createColumn({
  //         name: "email",
  //         join: "employee",
  //         label: "Email"
  //       }),
  //       search.createColumn({
  //         name: "entityid",
  //         join: "employee",
  //         label: "ID"
  //       }),
  //       search.createColumn({
  //         name: "internalid",
  //         join: "employee",
  //         label: "Internal ID"
  //       }),
  //       search.createColumn({
  //         name: "altname",
  //         join: "employee",
  //         label: "Name"
  //       }),
  //       search.createColumn({ name: "currency", label: "Currency" }),
  //       search.createColumn({
  //         name: "symbol",
  //         join: "Currency",
  //         label: "Symbol"
  //       }),
  //       search.createColumn({ name: "transactionname", label: "Transaction Name" }),
  //       search.createColumn({ name: "transactionnumber", label: "Transaction Number" }),
  //       search.createColumn({ name: "tranid", label: "Document Number" }),
  //       search.createColumn({ name: "subsidiary", label: "Subsidiary" }),
  //       search.createColumn({
  //         name: "country",
  //         join: "subsidiary",
  //         label: "Country"
  //       }),
  //       search.createColumn({
  //         name: "address1",
  //         join: "subsidiary",
  //         label: "Address 1"
  //       }),
  //       search.createColumn({
  //         name: "address2",
  //         join: "subsidiary",
  //         label: "Address 2"
  //       }),
  //       search.createColumn({
  //         name: "city",
  //         join: "subsidiary",
  //         label: "City"
  //       }),
  //       search.createColumn({
  //         name: "state",
  //         join: "subsidiary",
  //         label: "State/Province"
  //       }),
  //       search.createColumn({
  //         name: "zip",
  //         join: "subsidiary",
  //         label: "Zip"
  //       }),
  //       search.createColumn({ name: "custbody_mhi_jpmc_isofilename", label: "JPM Linked File Name" }),
  //       search.createColumn({ name: "custbody_mhi_jpmc_isofile", label: "Linked JPMC File" })
  //     ]
  //   });
  //   const searchResultCount = vendorpaymentSearchObj.runPaged().count;
  //   log.debug("vendorpaymentSearchObj result count", searchResultCount);
  //   vendorpaymentSearchObj.run().each((result) =>
  //     // .run().each has a limit of 4,000 results
  //     true);

  //   /*
  //  vendorpaymentSearchObj.id="customsearch1750440132306";
  //  vendorpaymentSearchObj.title="** DO NOT EDIT OR DELETE ** MHI | BoC File Generation Search V2 (copy)";
  //  var newSearchId = vendorpaymentSearchObj.save();
  //  */
  // }

  return {
    getInputData,
    map,
    reduce,
    summarize,
  };
});
