/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(["N/search", "N/ui/message", "N/url"], (SEARCH, MESSAGE, URL) => {
  /**
   * Triggered when the page is initialized.
   * @param {Object} context
   */
  function pageInit(context) {
    // empty
  }

  /**
   * Triggered when the record is being saved.
   * Return true to allow save, false to prevent.
   * @param {Object} context
   * @returns {boolean}
   */
  function saveRecord(context) {
    const currRec = context.currentRecord;

    const resolveVendorUrl = (vendorId) =>
      URL.resolveRecord({ recordType: "vendor", recordId: vendorId });
    if (currRec.id) return true;
    const taxIdNum = (currRec.getValue({ fieldId: "taxidnum" }) || "").trim();
    if (!taxIdNum) return true;

    const results = SEARCH.create({
      type: SEARCH.Type.VENDOR,
      filters: [["taxidnum", "is", taxIdNum]],
      columns: ["internalid", "entityid"],
    })
      .run()
      .getRange({ start: 0, end: 1 });

    if (results && results.length > 0) {
      const vendorName = results[0].getValue
        ? results[0].getValue({ name: "entityid" })
        : null;
      const vendorId = results[0].getValue({ name: "internalid" });
      const vendorUrl = resolveVendorUrl(vendorId);
      MESSAGE.create({
        title: "Duplicate Tax ID",
        message: `Tax ID: ${taxIdNum} is already used${vendorName ? ` by <a href="${vendorUrl}" target="_blank">${vendorName}</a>` : ""}. Please update the Tax Id and try again.`,
        type: MESSAGE.Type.ERROR,
      }).show();
      return false;
    } else return true;
  }

  return {
    pageInit,
    saveRecord,
  };
});
