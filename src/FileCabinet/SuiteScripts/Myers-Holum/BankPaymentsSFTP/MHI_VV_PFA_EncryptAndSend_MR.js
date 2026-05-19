/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * MHI | VV | PFA Encrypt and Send (Map/Reduce)
 *
 * For each Payment File Administration (PFA) record returned by the
 * configured saved search:
 *   1. Load SFTP credentials from the configured SFTP env config record.
 *   2. Load the file attached to the PFA.
 *   3. PGP-encrypt the file using the bank's public key (and optionally
 *      sign with our private key).
 *   4. Upload the ciphertext to the bank's SFTP destination.
 *
 * The saved search is responsible for filtering down to PFAs eligible to
 * send; getInputData trusts every row it returns. Map handles one PFA per
 * execution (1,000 governance units available per instance).
 */
define([
  "N/search",
  "N/record",
  "N/log",
  "./MHI_VV_BankPayments_Constants",
  "./MHI_VV_BankPayments_Lib",
], (search, record, log, constants, lib) => {
  const { RECORDS, PFA_FIELDS, SCRIPT_PARAMS } = constants;

  function getInputData() {
    const searchId = lib.getScriptParam(SCRIPT_PARAMS.PFA_SEARCH);

    log.audit({
      title: "getInputData",
      details: "Loading saved search " + searchId,
    });

    return search.load({ id: searchId });
  }

  function map(context) {
    const sftpConfigId = lib.getScriptParam(SCRIPT_PARAMS.SFTP_CONFIG_REC);

    const searchResult = JSON.parse(context.value);
    const pfaId = searchResult.id;

    try {
      const pfa = record.load({
        type: RECORDS.PFA,
        id: pfaId,
      });
      const fileId = pfa.getValue({ fieldId: PFA_FIELDS.FILE_REF });
      log.audit("PFA " + pfaId + " has file ID " + fileId);
      if (!fileId) {
        log.error({
          title: "PFA missing file reference",
          details: "PFA " + pfaId + " has no file attached; skipping.",
        });
        return;
      }
      const sftpConfig = lib.loadSftpConfig(sftpConfigId);
      log.audit(`Loaded SFTP config ${sftpConfigId}`, sftpConfig);

      const encryptedFile = lib.loadEncryptedFile(fileId);

      lib.uploadToSftp(sftpConfig, encryptedFile);

      log.audit({
        title: "Delivered",
        details: {
          pfaId: pfaId,
          fileName: encryptedFile.name,
          sftpConfigId: sftpConfig.id,
        },
      });
    } catch (e) {
      log.error({
        title: "Failed to deliver PFA " + pfaId,
        details: e,
      });
      throw e;
    }
  }

  function summarize(summary) {
    let numFailed = 0;
    let numProcessed = 0;

    summary.mapSummary.keys.iterator().each(() => {
      numProcessed += 1;
      return true;
    });

    summary.mapSummary.errors.iterator().each((key, error) => {
      numFailed += 1;
      log.error({
        title: "Unhandled map error for key " + key,
        details: error,
      });
      return true;
    });

    log.audit({
      title: "Run complete",
      details: {
        numProcessed: numProcessed,
        numFailed: numFailed,
        usageConsumed: summary.usage,
        seconds: summary.seconds,
      },
    });
  }

  return {
    getInputData: getInputData,
    map: map,
    summarize: summarize,
  };
});
