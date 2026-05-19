/**
 * @NApiVersion 2.1
 *
 * MHI | VV | Bank Payments SFTP — Helper Library
 *
 * Helpers for the PFA Encrypt-and-Send Map/Reduce script. Keeps the M/R
 * stages focused on orchestration; this module owns the details of reading
 * the SFTP environment config, PGP-encrypting payment files, and uploading
 * via N/sftp.
 */
define([
  "N/runtime",
  "N/record",
  "N/file",
  "N/pgp",
  "N/sftp",
  "./MHI_VV_BankPayments_Constants",
], (runtime, record, file, pgp, sftp, constants) => {
  const {
    SFTP_CONFIG_FIELDS,
    RECORDS,
    PFA_FIELDS,
    PGP_SECRETS,
    KEYS,
    VV_PARTNER_ID,
  } = constants;

  /**
   * Read a deployment script parameter and assert it has a value.
   * @param {string} paramId — the script parameter scriptId
   * @returns {string|number}
   */
  function getScriptParam(paramId) {
    const value = runtime.getCurrentScript().getParameter({ name: paramId });

    if (value === null || value === undefined || value === "") {
      throw new Error("Required script parameter is missing: " + paramId);
    }

    return value;
  }

  /**
   * Load the SFTP environment config record and return the values needed
   * to open a connection. Each required field is null-checked so a missing
   * value surfaces as a clear, actionable error instead of a stack trace
   * deep inside N/sftp.
   */
  function loadSftpConfig(configId) {
    if (!configId) {
      throw new Error("loadSftpConfig: configId is required");
    }

    const cfg = record.load({
      type: RECORDS.SFTP_CONFIG,
      id: configId,
    });

    const result = {
      id: configId,
      address: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.ADDRESS }),
      port: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.PORT }),
      username: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.USERNAME }),
      passwordGuid: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.PASSWORD_GUID }),
      hostkey: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.HOSTKEY }),
      direction: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.DIRECTION }),
      remotePath: cfg.getValue({ fieldId: SFTP_CONFIG_FIELDS.REMOTE_PATH }),
    };

    const required = ["address", "username", "hostkey"];
    required.forEach((key) => {
      if (!result[key]) {
        throw new Error(
          "SFTP config record " +
            configId +
            " is missing required field: " +
            key,
        );
      }
    });

    result.port = parseInt(result.port, 10) || 22;

    return result;
  }

  /**
   * Load a file by internal id, encrypt with PGP, and return a new in-memory
   * N/file object containing the ASCII-armored ciphertext. Caller is
   * responsible for uploading or persisting the result.
   *
   * @param {number|string} fileId
   * @param {string} publicKeySecretId
   * @param {string} [signingKeySecretId] — pass falsey to skip signing
   * @returns {File}
   */
  function loadEncryptedFile(fileId) {
    if (!fileId) {
      throw new Error("loadEncryptedFile: fileId is required");
    }

    const original = file.load({ id: fileId });
    log.audit("the secret ids", { PGP_SECRETS });
    const encryptOptions = {};
    encryptOptions.encryptionKeys = pgp.loadKeyFromSecret({
      secret: { scriptId: PGP_SECRETS.BANK_PUBLIC_KEY },
    });
    log.audit("public key", encryptOptions);
    encryptOptions.signingKeys = pgp.loadKeyFromSecret({
      secret: { scriptId: PGP_SECRETS.SIGNING_KEY },
      password: { scriptId: PGP_SECRETS.SIGNING_PASSWORD },
    });

    log.audit("Encrypt options", encryptOptions);

    const armored = pgp
      .createMessageData({ content: original.getContents() })
      .encrypt(encryptOptions)
      .asArmored();

    // const parseMessage = pgp.parseMessage({
    //   value: armored,
    // });
    // const msgData = parseMessage.decrypt({
    //   decryptionKeys: pgp.loadKeyFromSecret({
    //     secret: { scriptId: PGP_SECRETS.SIGNING_KEY },
    //     password: { scriptId: PGP_SECRETS.SIGNING_PASSWORD },
    //   }),
    //   verificationKeys: pgp.loadKeyFromSecret({
    //     secret: { scriptId: PGP_SECRETS.BANK_PUBLIC_KEY },
    //   }),
    // });
    // msgData.getText();

    return file.create({
      name: `${VV_PARTNER_ID}.PAYMENTS.ISO20022_PAIN_01Ver3.${getYYYYMMDDHHMMSS()}`,
      fileType: file.Type.XMLDOC,
      contents: armored,
    });
    // const newFileId = newFile.save();

    // return newFileId;
  }

  /**
   * Open an SFTP connection using the loaded config and upload the given
   * file. `replaceExisting: true` ensures retries don't fail because a
   * partial file from a prior attempt is sitting in the destination.
   */
  function uploadToSftp(sftpConfig, fileToSend) {
    if (!sftpConfig) {
      throw new Error("uploadToSftp: sftpConfig is required");
    }

    if (!fileToSend) {
      throw new Error("uploadToSftp: fileToSend is required");
    }

    const connectionOptions = {
      username: sftpConfig.username,
      // passwordGuid: sftpConfig.passwordGuid,
      keyId: KEYS.JPM_TRANSMISSION_KEY,
      url: sftpConfig.address,
      port: sftpConfig.port,
      hostKey: sftpConfig.hostkey,
    };

    const connection = sftp.createConnection(connectionOptions);

    connection.upload({
      file: fileToSend,
      replaceExisting: true,
      directory: "/PAIN001",
    });
  }

  /**
   * Optional: stamp a status value back onto the PFA after a successful
   * delivery. Use submitFields to keep the write cheap (10 governance units
   * vs. ~20 for a full record save).
   */
  function markPfaStatus(pfaId, statusValue) {
    if (!pfaId || !statusValue) {
      return;
    }

    const values = {};
    values[PFA_FIELDS.STATUS] = statusValue;

    record.submitFields({
      type: RECORDS.PFA,
      id: pfaId,
      values: values,
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

  return {
    getScriptParam: getScriptParam,
    loadSftpConfig: loadSftpConfig,
    loadEncryptedFile: loadEncryptedFile,
    uploadToSftp: uploadToSftp,
    markPfaStatus: markPfaStatus,
  };
});
