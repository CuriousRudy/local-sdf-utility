/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 *
 * MHI_PINN_PaycomDatasetExport
 *
 * Loads a saved search, runs it with runPaged() (to step past the 4,000-result
 * cap), reads every column off each result via search.columns (so the many
 * formulatext columns don't have to be fetched by name), and renders the
 * results as a CSV in the File Cabinet.
 */
define(["N/search", "N/file", "N/log", "N/runtime", "N/format"], (
  search,
  file,
  log,
  runtime,
  format,
) => {
  const PAGE_SIZE = 1000;

  const PARAMS = {
    searchId: "custscript_mhi_ppc_paycom_search_id",
    folderId: "custscript_mhi_ppc_paycom_folder_id",
    filePrefix: "custscript_mhi_ppc_paycom_file_prefix",
  };

  /**
   * Wraps a single CSV field: doubles embedded quotes and quotes any value
   * that contains a comma, quote, or line break. Null/undefined become "".
   */
  const csvEscape = (value) => {
    const str = value === null || value === undefined ? "" : String(value);

    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }

    return str;
  };

  /**
   * Joins an array of already-stringified fields into one CSV row.
   */
  const buildRow = (fields) => fields.map(csvEscape).join(",");

  /**
   * Builds the header row from the search's column definitions. Prefers the
   * column label (what the user sees in the saved search), falling back to the
   * field name and finally the formula text for unlabeled formula columns.
   */
  const buildHeader = (columns) => {
    const labels = columns.map((column) => {
      if (column.label) {
        return column.label;
      }

      if (column.name) {
        return column.name;
      }

      return column.formula || "";
    });

    return buildRow(labels);
  };

  /**
   * Reads every column value off a single result, in column order, using the
   * column objects rather than field names so formula columns are handled.
   */
  const resultToRow = (result, columns) => {
    const fields = columns.map((column) => {
      const resVal = result.getValue(column);
      const resText = result.getText(column);

      if (resText !== null && resText !== undefined) {
        return resText;
      } else return resVal !== null && resVal !== undefined ? resVal : "";
    });

    return buildRow(fields);
  };

  const getRequiredParam = (scriptObj, paramId) => {
    const value = scriptObj.getParameter({ name: paramId });

    if (value === null || value === undefined || value === "") {
      throw new Error("Missing required script parameter: " + paramId);
    }

    return value;
  };

  const execute = () => {
    const scriptObj = runtime.getCurrentScript();
    const searchId = getRequiredParam(scriptObj, PARAMS.searchId);
    const folderId = getRequiredParam(scriptObj, PARAMS.folderId);
    const filePrefix =
      scriptObj.getParameter({ name: PARAMS.filePrefix }) || "LAI02_";

    log.audit({
      title: "Export started",
      details: `Search: ${searchId}, Folder: ${folderId}`,
    });

    const searchObj = search.load({ id: searchId });
    const { columns } = searchObj;

    const lines = [buildHeader(columns)];
    let rowCount = 0;

    const pagedData = searchObj.runPaged({ pageSize: PAGE_SIZE });

    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });

      page.data.forEach((result) => {
        lines.push(resultToRow(result, columns));
        rowCount += 1;
      });
    });

    const stamp = format
      .format({ value: new Date(), type: format.Type.DATETIME })
      .replace(/[^0-9]/g, "");
    const fileName = `${filePrefix}_${stamp}.csv`;

    const csvFile = file.create({
      name: fileName,
      fileType: file.Type.CSV,
      contents: lines.join("\n"),
      folder: parseInt(folderId, 10),
    });

    const fileId = csvFile.save();

    log.audit({
      title: "Export complete",
      details: `Rows: ${rowCount}, File: ${fileName} (id ${fileId})`,
    });
  };

  return { execute };
});
