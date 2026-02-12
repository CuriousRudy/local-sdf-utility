/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define(["N/runtime", "../MHI_lodash.js"], function (RUNTIME, _) {
  const SUPER = 71290; // set this field to your employee internalid to enable superuser things
  const SECRET_ADMIN = "I did my waiting! Twelve years of it! In Azkaban!"; // if you see this in your config object, su is enabled

  // ============================================ RECORD TYPES ============================================
  // Customer Item Master (Parent)
  const CIM_TYPEID = "1842";
  const CIM_RECORDID = "customrecord_mhi_cim_parentrecord";
  // Forecaset Sales Record
  const FS_RECORDID = "customrecord_mhi_cim_forecastedsales";
  // Forecast Sales History
  const FSH_RECORDID = "customrecord_mhi_cim_fsh";

  // ============================================ CUSTOM FIELDS ===========================================
  // Customer Item Master (Parent)
  const CIM_CUSTOMER = "custrecord_mhi_customer_cmi";
  const CIM_ITEM = "custrecord_mhi_item_cmi";
  const CIM_SUPPLIER = "custrecord_mhi_cim_prefsupplier";
  const CIM_DISPLAYNAME = "custrecord_mhi_cim_dispname";
  const CIM_STOCKUNIT = "custrecord_mhi_cim_primstockunit";
  const CIM_SALEUNIT = "custrecord_mhi_cim_primsaleunit";
  const CIM_SUPPLIERCODE = "custrecord_mhi_cim_customerpart";
  const CIM_CUSTPRICE = "custrecord_mhi_cim_resale_price";
  const CIM_3MOAVG = "custrecord_mhi_cim_3monthavg";
  const CIM_DOCPRESENT = "custrecord_mhi_cim_docpresent";
  const CIM_CHANGENOTES = "custrecord_mhi_cim_changenotes";
  const CIM_ACTIVE = "custrecord_mhi_cim_activefs";
  const CIM_REVIEWED = "custrecord_mhi_cim_reviewed";
  const CIM_REVIEWEDATE = "custrecord_mhi_cim_revdate";
  const CIM_INVLOC = "custrecord_mhi_cim_loc";
  const CIM_OVERRIDE = "custrecord_mhi_api_override_cim_dupe";
  const CIM_FCSALESMETHOD = "custrecord_mhi_cim_prefstockmethod";
  const CIM_RESALE_UOM = "custrecord_mhi_resaleuom";
  const CIM_SALESREP = "custrecord_mhi_cim_salerep";
  const CIM_INVOICEDESC = "custrecord_mhi_cim_custinvdesc";
  const CIM_AUTOCREATED = "custrecord_mhi_cim_autocreated";
  const CIM_PRICELEVEL = "custrecord_mhi_cim_pricelevel";
  const CIM_PRICESTRAT = "custrecord_mhi_api_cimpircingstrat";
  const CIM_LASTSALE = "custrecord_mhi_cim_lastsaledate";
  const CIM_STATUS = "custrecord_mhi_cim_active";
  const CIM_NEWPRICE = "custrecord_mhi_cim_newprice";
  const CIM_CHANGEDATE = "custrecord_mhi_changedate";
  const CIM_CUSTPRICEMARGIN = "custrecord_mhi_cim_resalegrossmargin";
  const CIM_UNITTYPE = "custrecord_mhi_cim_unittype";
  const CIM_CUSTUOMSEL = "custpage_uom_select";
  const CIM_SALES_TEAM = "custrecord_mhi_api_cim_sales_team";

  // Forecase Sales Record
  const FS_ITEM = "custrecord_mhi_cim_fs_item";
  const FS_LOCATION = "custrecord_mhi_cim_fs_invlocation";
  const FS_CIMPARENT = "custrecord_mhi_cim_fs_parentcim";
  const FS_3MOAVG = "custrecord_mhi_cim_fs_3monthavg";
  const FS_DOCPRESENT = "custrecord_mhi_cim_fs_docpresent";
  const FS_CHANGENOTES = "custrecord_mhi_cim_fs_changenotes";
  const FS_ACTIVE = "custrecord_mhi_cim_fs_active";
  const FS_REVIEWED = "custrecord_mhi_cim_fs_reviewed";
  const FS_REVIEWEDATE = "custrecord_mhi_cim_fs_revdate";
  const FS_CURRMONTH = "custrecord_mhi_cim_fs_currentmonth";
  const FS_SALES_TEAM = "custrecord_mhi_api_fs_sales_team";
  const FS_CIM_CUSTOMER = "custrecord_mhi_api_cim_fs_customer";

  // Forecast Sales History
  const FSH_PARENT_FS = "custrecord_mhi_cim_fsh_parentfs";
  const FSH_CURRMONTH_ID = "custrecord_mhi_cim_fsh_curmonthqty";
  const FSH_REVIEWDATE_ID = "custrecord_mhi_cim_fsh_reviewdate";
  const FSH_CHANGENOTES = "custrecord_mhi_cim_fsh_changenotes";
  const FSH_LOCATION = "custrecord_mhi_cim_fsh_location";
  const FSH_ITEM = "custrecord_mhi_cim_fsh_item";
  const FSH_SALES_TEAM = "custrecord_mhi_api_fsh_sales_team";

  // List Values
  const CIM_METHOD_STOCK = "1";
  const ITEM_CUSTOM_PRICELVL = "-1";
  const CIM_CUSTOM_PRICING = "2";
  const CIM_MARGIN_PRICING = "1";
  const CIM_ISACTIVE = "1";
  const CIM_ISINACTIVE = "2";
  const INV_FSMFORM = "278";

  // =========================================== SAVED SEARCHES ==========================================
  const SALESTEAM_SEARCH = "customsearch_mhi_api_salesteammembers";

  // ============================================ MAPPINGS & FRIENDS ===========================================
  // this maps the cim custom fields to the search result names
  const ITEMSET_MAP = [
    { field: CIM_DISPLAYNAME, search: "displayname" },
    { field: CIM_STOCKUNIT, search: "stockunit" },
    { field: CIM_SALEUNIT, search: "saleunit" },
    // { field: CIM_SUPPLIERCODE, search: "vendorcode" },
    { field: CIM_SUPPLIER, search: "vendor" },
  ];

  // maps cim fields to forecast sales record fields
  const FORECAST_MAP = [
    { cimval: CIM_INVLOC, forecastval: FS_LOCATION, bool: false },
    { cimval: CIM_ITEM, forecastval: FS_ITEM, bool: false },

    {
      cimval: CIM_3MOAVG,
      forecastval: FS_3MOAVG,
      bool: false,
    },
    {
      cimval: CIM_DOCPRESENT,
      forecastval: FS_DOCPRESENT,
      bool: true,
    },
    {
      cimval: CIM_CHANGENOTES,
      forecastval: FS_CHANGENOTES,
      bool: false,
    },
    {
      cimval: CIM_ACTIVE,
      forecastval: FS_ACTIVE,
      bool: true,
    },
    {
      cimval: CIM_REVIEWED,
      forecastval: FS_REVIEWED,
      bool: true,
      // supplement: {
      //   cimval: "custrecord_mhi_cim_revdate",
      //   forecastval: "custrecord_mhi_cim_fs_revdate",
      // },
      // func: (val) => {
      //   if (val) return new Date();
      // },
    },
    {
      cimval: CIM_REVIEWEDATE,
      forecastval: FS_REVIEWEDATE,
    },
  ];

  // this maps the pricing method to the field that holds the price for that method
  const CIM_PRICINGMAP = {
    2: CIM_CUSTPRICE,
    1: CIM_NEWPRICE,
  };

  // this maps the cim fields to the item record fields for the item on the cim
  const ITEM_CIM_MAP = {
    header: [
      { itemval: "salesrep", cimval: CIM_SALESREP },
      { itemval: "customer", cimval: CIM_CUSTOMER },
    ],
    lines: [
      {
        itemval: "item",
        cimval: CIM_ITEM,
      },
      {
        itemval: "rate",
        cimval: CIM_CUSTPRICE,
      },
      {
        itemval: "description",
        cimval: CIM_INVOICEDESC,
      },
      {
        itemval: "autocreated",
        cimval: CIM_AUTOCREATED,
      },
    ],
  };

  // maps cim fields to item line fields
  const CIM_ITEMLINE_MAP = [
    { cimval: "custrecord_mhi_minordqty", lineval: "custcol_mhi_cim_minqty" },
    {
      cimval: CIM_SUPPLIERCODE,
      lineval: "custcol_mhi_api_custpartno",
    },
    { cimval: CIM_SALEUNIT, lineval: "units" },
    { cimval: CIM_INVOICEDESC, lineval: "description" },
    { cimval: "custrecord_mhi_cim_devpurchaseprice", lineval: false },
    // { cimval: "custrecord_mhi_cim_devpurchaseuom", lineval: false },
    // {
    //   cimval: "cseg_mhi_distsource",
    //   lineval: "custcol_mhi_cim_distsourcetraline",
    // },
    {
      cimval: "custrecord_mhi_deviatedprice",
      lineval: "custcol_mhi_deviated_pp_applied",
    },
    {
      cimval: CIM_FCSALESMETHOD,
      lineval: false,
    },
    {
      cimval: "custrecord_mhi_api_update_psm_on_tran",
      lineval: false,
    },
    {
      cimval: "custrecord_mhi_cim_unittype",
      lineval: false,
    },
    // { cimval: CIM_RESALE_UOM, lineval: "units" },

    // { cimval: "custrecord_mhi_cim_resale_price", lineval: "rate" },
  ];

  const CIM_SALESTEAM_MAP = {
    [CIM_RECORDID]: CIM_SALES_TEAM,
    [FS_RECORDID]: FS_SALES_TEAM,
    [FSH_RECORDID]: FSH_SALES_TEAM,
  };

  // const FS_HISTORY_MAP;

  return {
    getVars: function () {
      let varsObj = {
        SUPER,
        // custom records
        CIM_TYPEID,
        CIM_RECORDID,
        FS_RECORDID,
        FSH_RECORDID,
        // custom fields
        CIM_CUSTOMER,
        CIM_ITEM,
        CIM_SUPPLIER,
        CIM_DISPLAYNAME,
        CIM_STOCKUNIT,
        CIM_SALEUNIT,
        CIM_SUPPLIERCODE,
        CIM_CUSTPRICE,
        CIM_3MOAVG,
        CIM_DOCPRESENT,
        CIM_CHANGENOTES,
        CIM_ACTIVE,
        CIM_REVIEWED,
        CIM_REVIEWEDATE,
        CIM_INVLOC,
        CIM_OVERRIDE,
        CIM_FCSALESMETHOD,
        CIM_RESALE_UOM,
        CIM_SALESREP,
        CIM_INVOICEDESC,
        CIM_AUTOCREATED,
        CIM_PRICELEVEL,
        CIM_PRICESTRAT,
        CIM_LASTSALE,
        CIM_STATUS,
        CIM_NEWPRICE,
        CIM_CHANGEDATE,
        CIM_CUSTPRICEMARGIN,
        CIM_UNITTYPE,
        CIM_CUSTUOMSEL,
        CIM_SALES_TEAM,
        FS_ITEM,
        FS_LOCATION,
        FS_CIMPARENT,
        FS_3MOAVG,
        FS_DOCPRESENT,
        FS_CHANGENOTES,
        FS_ACTIVE,
        FS_REVIEWED,
        FS_REVIEWEDATE,
        FS_CURRMONTH,
        FS_SALES_TEAM,
        FS_CIM_CUSTOMER,
        FSH_PARENT_FS,
        FSH_CURRMONTH_ID,
        FSH_REVIEWDATE_ID,
        FSH_CHANGENOTES,
        FSH_LOCATION,
        FSH_ITEM,
        FSH_SALES_TEAM,
        // list values
        CIM_METHOD_STOCK,
        ITEM_CUSTOM_PRICELVL,
        CIM_CUSTOM_PRICING,
        CIM_MARGIN_PRICING,
        CIM_ISACTIVE,
        CIM_ISINACTIVE,
        INV_FSMFORM,
        // saved searches
        SALESTEAM_SEARCH,
        // mappings and friends
        ITEMSET_MAP,
        FORECAST_MAP,
        CIM_PRICINGMAP,
        ITEM_CIM_MAP,
        CIM_ITEMLINE_MAP,
        CIM_SALESTEAM_MAP,
      };
      // if (RUNTIME.getCurrentUser().id == SUPER) {
      //   varsObj.SUPER = true;
      //   varsObj.SECRET = SECRET_ADMIN;
      // }

      return varsObj;
    },
  };
});
