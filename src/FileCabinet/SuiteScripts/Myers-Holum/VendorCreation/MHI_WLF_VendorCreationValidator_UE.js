/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/error"], (search, error) => {
  const beforeSubmit = (context) => {
    if (context.type !== context.UserEventType.CREATE) return;

    const rec = context.newRecord;
    const taxId = rec.getValue({ fieldId: "taxidnum" });
    if (!taxId) return;

    const results = search
      .create({
        type: search.Type.VENDOR,
        filters: [["taxidnum", "is", taxId]],
        columns: ["internalid", "entityid"],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    if (results && results.length > 0) {
      const existingId = results[0].getValue("internalid");
      const existingName = results[0].getValue("entityid") || existingId;
      throw error.create({
        name: "DUPLICATE_TAXID",
        message: `Tax ID "${taxId}" is already used by vendor ${existingName} (ID ${existingId}).`,
      });
    }
  };

  return { beforeSubmit };
});
