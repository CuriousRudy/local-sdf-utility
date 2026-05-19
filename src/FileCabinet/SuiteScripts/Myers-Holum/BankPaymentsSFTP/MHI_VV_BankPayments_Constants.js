/**
 * @NApiVersion 2.1
 *
 * MHI | VV | Bank Payments SFTP — Constants
 *
 * Single source of truth for record types, field IDs, list values, script
 * parameter IDs, and PGP secret scriptIDs used by the PFA Encrypt-and-Send
 * Map/Reduce script and its companion library.
 *
 * Items marked TODO must be confirmed against the target NetSuite account
 * before deployment.
 */
define([], () => {
  const VV_PARTNER_ID = "VINEYISO";

  const RECORDS = {
    PFA: "customrecord_2663_file_admin",
    SFTP_CONFIG: "customrecord_mhi_vv_sftp_env_config",
  };

  // PFA fields exposed by the NetSuite Bank Payments bundle.
  // TODO confirm these field scriptids in the target account.
  const PFA_FIELDS = {
    FILE_REF: "custrecord_2663_file_ref",
    STATUS: "custrecord_2663_status", // TODO
  };

  const SFTP_CONFIG_FIELDS = {
    ADDRESS: "custrecord_mhi_vv_sftp_config_address",
    PORT: "custrecord_mhi_vv_sftp_config_port",
    USERNAME: "custrecord_mhi_vv_sftp_config_username",
    PASSWORD: "custrecord_mhi_vv_sftp_config_password",
    PASSWORD_GUID: "custrecord_mhi_vv_sftp_config_guid",
    HOSTKEY: "custrecord_mhi_vv_sftp_config_hostkey",
    DIRECTION: "custrecord_mhi_vv_sftp_config_flowdir",
    REMOTE_PATH: "custrecord_mhi_vv_sftp_remote_path",
  };

  const LISTS = {
    DIRECTION: "customlist_mhi_vv_sftp_config_flowdir",
  };

  // Internal numeric IDs of the customlist values.
  // TODO confirm after the customlist is deployed to the target account.
  const DIRECTION_VALUES = {
    INBOUND: "1",
    OUTBOUND: "2",
  };

  // Script parameter scriptIDs (defined on the deployment record).
  const SCRIPT_PARAMS = {
    SFTP_CONFIG_REC: "custscript_mhi_vv_jpm_encrypt_sftpconfig",
    PFA_SEARCH: "custscript_mhi_vv_jpm_encrypt_search",
  };

  // PGP secret scriptIDs — created in NetSuite Setup > Company > Secrets.
  // TODO replace placeholders with the real scriptIDs from the target account.
  // Set SIGNING_KEY to null if signing is not required by the receiving bank.
  const PGP_SECRETS = {
    BANK_PUBLIC_KEY: "custsecret_mhi_vv_jpm_pubkey",
    SIGNING_KEY: "custsecret_mhi_vv_jpm_privkey",
    SIGNING_PASSWORD: "custsecret_mhi_vv_jpm_keysign_pw",
  };

  const KEYS = {
    JPM_TRANSMISSION_KEY: "custkey_jpm_absi_prikey",
  };

  return {
    VV_PARTNER_ID,
    RECORDS,
    PFA_FIELDS,
    SFTP_CONFIG_FIELDS,
    LISTS,
    DIRECTION_VALUES,
    SCRIPT_PARAMS,
    PGP_SECRETS,
    KEYS,
  };
});
