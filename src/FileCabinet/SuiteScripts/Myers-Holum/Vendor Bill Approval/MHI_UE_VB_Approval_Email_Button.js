/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
/*
Name                : MHI_UE_VB_Approval_Email_Button.js
Purpose             : Script to add send approval email button.
Created On          : 4 Feb 2025
Author              : Saroja Iyer
*/
define(["N/search", "N/runtime", "N/record", "N/email", "N/render", "N/url"], (
  search,
  runtime,
  record,
  email,
  render,
  url,
) => {
  //Function to create button.
  const createButton = (scriptContext) => {
    if (scriptContext.type == scriptContext.UserEventType.VIEW) {
      try {
        var form = scriptContext.form;

        const currentrecord = scriptContext.newRecord;
        const recordid = currentrecord.id;
        let tranNumber = currentrecord.getValue({ fieldId: "tranid" });
        log.debug("recordid", recordid);

        let approvalStatus = currentrecord.getValue({
          fieldId: "approvalstatus",
        });
        let matters = currentrecord.getValue({ fieldId: "cseg_mhi_matters" });

        //Only execute if matters is populated
        if (isEmpty(matters)) return;

        form.clientScriptModulePath = "./MHI_CS_VB_Email_Approval.js";

        let currentScript = runtime.getCurrentScript();
        let PENDING_APPROVAL = currentScript.getParameter(
          "custscript_mhi_pending_appr_status",
        );
        let REJECTED_STATUS = currentScript.getParameter(
          "custscript_mhi_rejected_status",
        );

        //Show follow up email button only if VB is not approved/rejected.
        if (approvalStatus == PENDING_APPROVAL) {
          //Creating a button on form.
          form.addButton({
            id: "custpage_submit_email_approval",
            label: "Send a Follow-Up Email",
            functionName:
              'emailApproval("' + recordid + '","' + tranNumber + '")',
          });
        } else if (approvalStatus == REJECTED_STATUS) {
          //Creating a resubmit button on form.
          form.addButton({
            id: "custpage_resubmit_email_approval",
            label: "Resubmit",
            functionName: 'reSubmit("' + recordid + '","' + tranNumber + '")',
          });
        }
      } catch (e) {
        log.error("Error Occurred:", e.message);
      }
    } else if (scriptContext.type == scriptContext.UserEventType.COPY) {
      log.audit("In Copy Trigger - Resetting matters field value");
      const currentUser = runtime.getCurrentUser();
      scriptContext.newRecord.setValue({
        fieldId: "custbody_mhi_approved_by",
        value: "",
      });

      if (currentUser) {
        log.debug("Current User ID", currentUser.id);
        scriptContext.newRecord.setValue({
          fieldId: "custbody_mhi_wlf_created_by",
          value: currentUser.id,
        });
      }
    }
  };
  const afterSubmit = (scriptContext) => {
    try {
      const currentrecord = scriptContext.newRecord;
      const recordid = currentrecord.id;
      log.debug("recordid", recordid);
      let trigger = scriptContext.type;

      let transType = scriptContext.newRecord.type;
      let currentScript = runtime.getCurrentScript();
      let PENDING_APPROVAL = currentScript.getParameter(
        "custscript_mhi_pending_appr_status",
      );

      switch (trigger) {
        case "create":
          let transaction = record.load({
            type: transType,
            id: scriptContext.newRecord.id,
            isDynamic: true,
          });
          let approvalStatus = transaction.getValue({
            fieldId: "approvalstatus",
          });
          let matters = transaction.getValue({ fieldId: "cseg_mhi_matters" });
          let tranNumber = transaction.getValue({ fieldId: "tranid" });
          log.debug("approvalStatus", approvalStatus);

          //Only execute if matters is populated
          if (isEmpty(matters)) return;

          //Matters lookup
          let mattersLookup = recLookup(
            "customrecord_cseg_mhi_matters",
            matters,
            "custrecord_mhi_approvers",
          );

          //Get list of approvers from matters record
          let recipientList =
            mattersLookup.custrecord_mhi_approvers.length > 0
              ? mattersLookup.custrecord_mhi_approvers.map(
                  (approver) => approver.value,
                )
              : [];
          log.debug("recipientList", recipientList);

          //Send pending approval email if VB still not approved/rejected
          if (approvalStatus == PENDING_APPROVAL) {
            sendEmail(recordid, tranNumber, recipientList);
          }
      }
    } catch (e) {
      log.error("afterSubmit Error Occurred:", e.message);
    }
  };

  //Function to lookup
  const recLookup = (recType, recID, fieldId) => {
    let lookupValues = search.lookupFields({
      type: recType,
      id: recID,
      columns: [fieldId],
    });
    return lookupValues;
  };

  //Function to send email
  const sendEmail = (recordid, tranNumber, recipientList) => {
    let currentScript = runtime.getCurrentScript();
    let pendingApprovalTemplateID = currentScript.getParameter(
      "custscript_mhi_pending_appr_email_temp",
    );
    let senderId = currentScript.getParameter("custscript_mhi_vb_email_sender");

    //Get pending approval email template
    let emailMergeResult = render.mergeEmail({
      templateId: pendingApprovalTemplateID,
      transactionId: recordid,
    });

    //Add attachment of transaction PDF to the email
    let transactionFile = render.transaction({
      entityId: Number(recordid),
      printMode: render.PrintMode.PDF,
      //inCustLocale: true
    });

    let suiteletURL = url.resolveScript({
      scriptId: "customscript_mhi_sl_vb_email_approval",
      deploymentId: "customdeploy_mhi_sl_vb_email_approval",
      returnExternalUrl: true,
    });

    //Send unique approval email to each recipient
    for (var i = 0; i < recipientList.length; i++) {
      let emailBody = emailMergeResult.body;
      let approveURL =
        suiteletURL +
        "&amp;recordId=" +
        Number(recordid) +
        "&amp;tranid=" +
        encodeURIComponent(tranNumber) +
        "&amp;action=approved&amp;empID=" +
        recipientList[i];
      emailBody = emailBody.replace("ApproveURL", approveURL);
      let rejectURL =
        suiteletURL +
        "&amp;recordId=" +
        Number(recordid) +
        "&amp;tranid=" +
        encodeURIComponent(tranNumber) +
        "&amp;action=rejectionReason&amp;empID=" +
        recipientList[i];
      emailBody = emailBody.replace("RejectURL", rejectURL);

      //Send email to approvers
      email.send({
        author: senderId,
        recipients: recipientList[i],
        subject: emailMergeResult.subject,
        body: emailBody,
        attachments: [transactionFile],
        relatedRecords: { transactionId: Number(recordid) },
      });
    }
    log.audit("Email sent for pending approval");
  };

  const isEmpty = (val) => {
    return (
      val === "" ||
      val == null ||
      false ||
      (val.constructor === Array && val.length == 0) ||
      (val.constructor === Object && Object.keys(val).length === 0)
    );
  };

  return {
    beforeLoad: createButton,
    afterSubmit: afterSubmit,
  };
});
