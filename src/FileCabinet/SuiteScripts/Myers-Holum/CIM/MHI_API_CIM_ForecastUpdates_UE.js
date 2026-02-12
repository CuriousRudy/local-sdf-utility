/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
  "N/record",
  "N/search",
  "N/runtime",
  "N/ui/serverWidget",
  "N/ui/message",
  "N/redirect",
  "../moment.min.js",
  "./MHI_API_CIM_Variables.js",
  "./MHI_API_CIM_Functions.js",
], function (RECORD, SEARCH, RUNTIME, SW, MSG, REDIRECT, MOMENT, VAR, FUNCS) {
  const VARS = VAR.getVars();
  function beforeLoad(context) {
    if (
      context.type === context.UserEventType.CREATE ||
      context.type === context.UserEventType.EDIT
    ) {
      const currentDate = new Date();
      if (currentDate.getDate() > 15) {
        context.form.getField({ id: VARS.FS_CURRMONTH }).updateDisplayType({
          displayType: "disabled",
        });
      }
    }

    if (
      context.type === context.UserEventType.EDIT ||
      context.type === context.UserEventType.VIEW
    ) {
      const { form, newRecord } = context;
      const itemid = newRecord.getValue({ fieldId: VARS.FS_ITEM });

      const parentCIM = newRecord.getValue({ fieldId: VARS.FS_CIMPARENT });
      // lookupFields to get customer from the parentCIM
      if (!parentCIM) return;

      const parentCIMFields = SEARCH.lookupFields({
        type: VARS.CIM_RECORDID,
        id: parentCIM,
        columns: [VARS.CIM_CUSTOMER],
      });

      let hasCustomer = false;
      if (parentCIMFields[VARS.CIM_CUSTOMER][0]) {
        hasCustomer = parentCIMFields[VARS.CIM_CUSTOMER][0].value;
      }

      if (hasCustomer && itemid) {
        const forecastTab = form.addTab({
          id: "custpage_forecast_tab",
          label: "Forecast History View",
        });

        let inlineHtmlField = form.addField({
          id: "custpage_inlinehtml",
          type: SW.FieldType.INLINEHTML,
          label: "Inline HTML",
          container: "custpage_forecast_tab",
        });

        const monthsArr = returnMonthsArr();
        log.audit("Months Array", monthsArr);

        // addFieldsToSublist(newSub, monthsArr);

        const formulaActualSearch = generateForecastSearch(
          hasCustomer,
          itemid,
          monthsArr,
        );

        // let lineCounter = 0;
        const linkedFSH = FUNCS.getLinkedSalesHistoryRecs(newRecord.id);
        if (linkedFSH) {
          log.audit("linkedFSH", linkedFSH);

          const actualsResult = formulaActualSearch.run().getRange({
            start: 0,
            end: 1,
          });

          populateForecastLines(
            linkedFSH,
            actualsResult,
            formulaActualSearch,
            monthsArr,
            form,
          );
        }
      }
      if (context.type === context.UserEventType.VIEW) {
        const currentDate = new Date();
        if (currentDate.getDate() > 15) {
          const message = MSG.create({
            title: "Restriction Notice",
            message:
              "Changes to the Current Month Quantity field are restricted after the 15th of the month.",
            type: MSG.Type.WARNING,
          });

          form.addPageInitMessage({
            message,
          });
        }
      }
    }
  }

  function beforeSubmit(context) {
    // before doing anything else, run this logic to ignore the original create/delete exit condition
    const { newRecord, type } = context;
    if (
      type === context.UserEventType.CREATE ||
      type === context.UserEventType.EDIT
    ) {
      const parentCIM = newRecord.getValue({ fieldId: VARS.FS_CIMPARENT });
      // lookupFields to get customer from the parentCIM
      if (parentCIM) {
        const parentCIMFields = SEARCH.lookupFields({
          type: VARS.CIM_RECORDID,
          id: parentCIM,
          columns: [VARS.CIM_CUSTOMER],
        });

        let hasCustomer = false;
        if (parentCIMFields[VARS.CIM_CUSTOMER][0]) {
          hasCustomer = parentCIMFields[VARS.CIM_CUSTOMER][0].value;
        }
        if (hasCustomer) {
          // if we get the customer, lookup the team members to set them in the new field
          const teamMembers = FUNCS.getSalesTeamMembers(hasCustomer);
          log.audit("BEFORESUBMIT : teamMembers", teamMembers);
          if (teamMembers.length)
            newRecord.setValue(VARS.FS_SALES_TEAM, teamMembers);
        }
      }
    }

    if (
      type === context.UserEventType.CREATE ||
      type === context.UserEventType.DELETE
    )
      return;

    const { oldRecord } = context;
    log.audit("BEFORESUBMIT : context", context);

    const currentDate = new Date();
    const oldReviewed = oldRecord.getValue({ fieldId: VARS.FS_REVIEWED });
    const newReviewed = newRecord.getValue({ fieldId: VARS.FS_REVIEWED });

    log.audit("BEFORESUBMIT : context", currentDate.getDate());
    if (currentDate.getDate() > 15) {
      const oldCurrMonth = oldRecord.getValue({ fieldId: VARS.FS_CURRMONTH });
      const newCurrMonth = newRecord.getValue({ fieldId: VARS.FS_CURRMONTH });

      if (context.type === context.UserEventType.XEDIT) {
        log.audit(
          "XEDIT: Current date is on or after the 15th, reverting FS_CURRMONTH",
          {
            oldCurrMonth,
            newCurrMonth,
            oldReviewed,
            newReviewed,
          },
        );
        if (newCurrMonth && oldCurrMonth !== newCurrMonth)
          newRecord.setValue({
            fieldId: VARS.FS_CURRMONTH,
            value: oldCurrMonth,
          });
      }
    }
    if (!oldReviewed && newReviewed) {
      newRecord.setValue({
        fieldId: VARS.FS_REVIEWEDATE,
        value: new Date(),
      });
    }
  }

  function afterSubmit(context) {}

  /**
   * Generates an array of objects representing the last 12 months including the current month.
   * Each object contains the following properties:
   * - dateStr: The formatted date string of the current day in the month (MM/DD/YYYY).
   * - monthStart: The formatted date string of the start of the month (MM/DD/YYYY).
   * - monthEnd: The formatted date string of the end of the month (MM/DD/YYYY).
   * - monthStr: The abbreviated month name in lowercase, with a '1' appended if the month is more than 11 months ago.
   * - col: A string representing the current month ID concatenated with the month index if the month is not the current month.
   *
   * @returns {Array<Object>} An array of objects representing the last 12 months.
   */
  function returnMonthsArr() {
    const currMonthId = VARS.FSH_CURRMONTH_ID;

    let monthArr = [];
    let todaysDate = new Date();
    for (let m = 0; m <= 12; m++) {
      let momOb = MOMENT(todaysDate).subtract(m, "month");
      let dateStr = momOb.format("MM/DD/YYYY");
      let monthStr =
        (m > 11 && `${momOb.format("MMM").toLowerCase()}1`) ||
        momOb.format("MMM").toLowerCase();
      let monthStart = momOb.startOf("month").format("MM/DD/YYYY");
      let monthEnd = momOb.endOf("month").format("MM/DD/YYYY");
      // log.debug('In MonthsArr Iteration{ dateStr, monthStart, monthEnd });
      monthArr.push({
        dateStr,
        monthStart,
        monthEnd,
        monthStr,
        col: (m > 0 && `${currMonthId}${m}`) || currMonthId,
      });
    }
    return monthArr;
  }

  /**
   * Populates forecast lines in a sublist and generates an HTML table to display forecast, actuals, and variance data.
   *
   * @param {Object} forecastRes - The forecast result object containing forecast data.
   * @param {Array} savesSearchRes - The saved search result array containing actual sales data.
   * @param {Object} searchObj - The search object used to retrieve actual sales data.
   * @param {Object} sublist - The sublist object where forecast, actuals, and variance data will be populated.
   * @param {Array} months - An array of month objects, each containing monthStart, monthEnd, and column name.
   * @param {Object} form - The form object where the HTML table will be added.
   */
  function populateForecastLines(
    forecastRes,
    savesSearchRes,
    searchObj,
    // sublist,
    months,
    form,
  ) {
    let forecastLine = 0;
    let actualsLine = 1;
    let varianceLine = 2;

    let headerHtml = "";
    let forecastHtml = "";
    let actualsHtml = "";
    let varianceHtml = "";

    // sublist.setSublistValue({
    //   id: "custpage_field_datasrc",
    //   line: forecastLine,
    //   value: "Forecast History Record",
    // });
    // sublist.setSublistValue({
    //   id: "custpage_field_datasrc",
    //   line: actualsLine,
    //   value: "Actual Sales",
    // });
    // sublist.setSublistValue({
    //   id: "custpage_field_datasrc",
    //   line: varianceLine,
    //   value: "Variance",
    // });

    months.forEach((monthOb, i) => {
      headerHtml += `<th>${monthOb.monthStart} - ${monthOb.monthEnd}</th>`;
      let fcAmt = forecastRes.getValue({
        name: monthOb.col,
      });
      let actAmt = savesSearchRes[0].getValue({
        name: searchObj.columns[i],
        summary: "SUM",
      });

      log.audit("actAmt", actAmt);

      const variance = fcAmt - actAmt;

      // sublist.setSublistValue({
      //   id: monthOb.col,
      //   line: forecastLine,
      //   value: fcAmt || 0,
      // });
      forecastHtml += `<td>${fcAmt || 0}</td>`;

      // sublist.setSublistValue({
      //   id: monthOb.col,
      //   line: actualsLine,
      //   value: actAmt || 0,
      // });
      actualsHtml += `<td>${actAmt || 0}</td>`;

      // sublist.setSublistValue({
      //   id: monthOb.col,
      //   line: varianceLine,
      //   value: (variance < 0 && `(${Math.abs(variance)})`) || variance,
      // });
      varianceHtml += `<td>${
        (variance < 0 && `(${Math.abs(variance)})`) || variance
      }</td>`;

      const htmlField = form.getField({
        id: "custpage_inlinehtml",
      });
      htmlField.defaultValue = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
        #forecastTable {
          width: 100%;
          border-collapse: collapse;
          font-family: 'Roboto', sans-serif;
          border-radius: 8px;
          overflow: hidden;
        }
        #forecastTable th, #forecastTable td {
          padding: 8px;
          border: 3px solid #ddd;
        }
        #forecastTable thead tr {
          background-color: #f2f2f2;
        }
        #forecastTable tbody tr:nth-child(even) {
          background-color: #f9f9f9;
        }
      </style>
      <table id="forecastTable"> 
        <thead>
          <tr>
        <th>Data Source</th>
        ${headerHtml}
          </tr>
        </thead>
        <tbody>
          <tr>
        <td>Forecast</td>
        ${forecastHtml}
          </tr>
          <tr>
        <td>Actuals</td>
        ${actualsHtml}
          </tr>
          <tr>
        <td>Variance</td>
        ${varianceHtml}
          </tr>
        </tbody>
      </table>`;
    });
  }

  /**
   * Adds fields to a sublist based on the provided months array.
   *
   * @param {Object} sublist - The sublist to which fields will be added.
   * @param {Array} monthsArr - An array of month objects, each containing `col`, `monthStart`, and `monthEnd` properties.
   */
  function addFieldsToSublist(sublist, monthsArr) {
    monthsArr.forEach((month, i) => {
      log.audit("month", {
        month,
        i,
      });
      sublist.addField({
        id: `${month.col}`,
        type: SW.FieldType.TEXT,
        label: `${month.monthStart} - ${month.monthEnd}`,
      });
    });
  }

  /**
   * Generates a forecast search for a given customer, item, and array of months.
   *
   * @param {number|string} customer - The internal ID or name of the customer.
   * @param {number|string} item - The internal ID or name of the item.
   * @param {Array<Object>} monthsArr - An array of month objects containing monthStart, monthEnd, and col properties.
   * @param {string} monthsArr[].monthStart - The start date of the month in 'MM/DD/YYYY' format.
   * @param {string} monthsArr[].monthEnd - The end date of the month in 'MM/DD/YYYY' format.
   * @param {string} monthsArr[].col - The label for the column.
   * @returns {Object} The generated forecast search object.
   */
  function generateForecastSearch(customer, item, monthsArr) {
    let forecastSearch = SEARCH.create({
      type: "transaction",
      filters: [
        ["name", SEARCH.Operator.ANYOF, customer],
        "AND",
        ["item", SEARCH.Operator.ANYOF, item],
        "AND",
        ["type", "anyof", "CustInvc"],
      ],
      columns: [],
    });

    _.forEach(monthsArr, (monthOb) => {
      forecastSearch.columns.push(
        SEARCH.createColumn({
          name: "formulanumeric",
          formula: `CASE WHEN {trandate} BETWEEN TO_DATE('${monthOb.monthStart}', 'MM/DD/YYYY') AND TO_DATE('${monthOb.monthEnd}', 'MM/DD/YYYY') THEN {quantity} ELSE 0 END`,
          label: monthOb.col,
          summary: SEARCH.Summary.SUM,
        }),
      );
    });
    return forecastSearch;
  }

  return {
    beforeSubmit: beforeSubmit,
    afterSubmit: afterSubmit,
    beforeLoad: beforeLoad,
  };
});
