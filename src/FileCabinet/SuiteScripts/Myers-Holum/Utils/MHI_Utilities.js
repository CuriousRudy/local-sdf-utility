/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([
  "N/search",
  "N/format",
  //   "../MHI_hb.js",
  "N/email",
  "N/record",
  "N/xml",
  "../MHI_lodash.js",
], function (SEARCH, FORMAT, EMAIL, RECORD, XML, _) {
  function isNumber(value) {
    if (_.isEmpty(value)) return false;

    if (!isNaN(value)) {
      return typeof Number(value) === "number" && isFinite(Number(value));
    } else return false;
  }

  /**
   * Extracts URL parameters from the current window's location search string and returns them as an object.
   *
   * @returns {Object} An object containing key-value pairs of URL parameters.
   */
  function getUrlParameters() {
    var urlParams = new URLSearchParams(window.location.search);
    var entries = urlParams.entries();
    // build params object
    var params = {};
    for (entry of entries) {
      if (
        entry[0] != "script" &&
        entry[0] != "deploy" &&
        entry[0] != "compid"
      ) {
        params[entry[0]] = entry[1];
      }
    }
    console.log(params);
    return params;
  }

  /**
   * Determines the item type based on the provided result object.
   *
   * @param {Object} resultObj - The result object containing item details.
   * @param {Function} resultObj.getValue - Function to get the value of a field from the result object.
   * @returns {string} The item type string.
   */
  function returnItemType(resultObj) {
    let typeString = REC.Type.INVENTORY_ITEM;
    const itemType = resultObj.getValue("type");
    if (itemType == "InvtPart") {
      const isLot = resultObj.getValue("islotitem");
      const isSerial = resultObj.getValue("isserialitem");

      if (isLot || isSerial) {
        if (isLot) {
          typeString = REC.Type.LOT_NUMBERED_INVENTORY_ITEM;
        }
        if (isSerial) {
          typeString = REC.Type.SERIALIZED_INVENTORY_ITEM;
        }
      } else {
        typeString = REC.Type.INVENTORY_ITEM;
      }
    }
    return typeString;
  }

  const validateAndReturnMsg = ({ min, max, inc, abs, datatype }, val) => {
    // const validateAndReturnMsg = (min, max, inc, val, datatype) => {
    let validationMsg = false;
    if (min) min = Number(min);
    if (max) max = Number(max);
    if (inc) inc = Number(inc);
    if (abs) {
      if (typeof abs === "string" && abs !== "") {
        abs = abs.split(",").map((s) => s.trim());
      }
    }
    // if (val) val = Number(val);
    // use runtime to get user id
    let returnValue = false;

    // use regexp to check for alpha characters
    let hasAlpha = /[a-zA-Z]/.test(val);

    if ((datatype == "Integer" || datatype == "Decimal") && hasAlpha) {
      validationMsg = `Expected ${datatype}, but got a non-numeric value: ${val}`;
    }
    if (datatype == "Fraction") {
      let fracRegex = /^(?:\d+ )?\d+\/\d+$|^\d+$/;
      const isFraction = fracRegex.test(val);
      if (!isFraction) {
        validationMsg = `Expected ${datatype}, but got a non-fraction value: ${val}`;
      } else {
        returnValue = val;
      }
    }

    if (datatype == "Decimal") {
      if (isNumber(val)) {
        // check if value is integer
        let decRegex = /^-?\d*\.?\d+$/;
        let isInt = Number.isInteger(Number(val));
        if (isInt) {
          // convert the integer to a decimal
          // don't force a Decimal anymore
          returnValue = Number(val);
        } else {
          let isDec = decRegex.test(val);
          if (!isDec) {
            validationMsg = `Expected ${datatype}, but got a non-decimal value: ${val}`;
          } else {
            returnValue = Number(val);
          }
        }
      } else {
        validationMsg = `Expected ${datatype}, but got a Free-Text value: ${val}`;
      }
    }
    if (returnValue) {
      if (min && max && isNumber(val) && val > -1) {
        if (val < min) {
          validationMsg = `Value must be greater than or equal to ${min}`;
        }

        if (val > max) {
          validationMsg = `Value must be less than or equal to ${max}`;
        }

        if (inc) {
          if (val % inc !== 0) {
            validationMsg = `Value must be a multiple of ${inc}`;
          }
        } else {
          console.log("No increment value");
        }

        if (abs && abs.length && !~abs.indexOf(val + "")) {
          validationMsg = `Value must be one of the following: ${abs.join(
            ", "
          )}`;
        }
      } else {
        if (min && max && !isNumber(val)) {
          validationMsg = `Expected ${datatype}, but got a non-numeric value: ${val}`;
        }

        if (abs && abs.length && !~abs.indexOf(val + "")) {
          validationMsg = `Value must be one of the following: ${abs.join(
            ", "
          )}`;
        }
      }
    } else {
      if (!validationMsg)
        validationMsg = `Expected ${datatype}, but got a blank value. Select a unit first.`;
    }

    return { returnValue, validationMsg };
  };

  return {
    isNumber,
    getUrlParameters,
    returnItemType,
    validateAndReturnMsg,
  };
});
