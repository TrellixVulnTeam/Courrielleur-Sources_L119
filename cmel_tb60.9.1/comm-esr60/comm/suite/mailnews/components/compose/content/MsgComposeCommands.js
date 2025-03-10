/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Commands for the message composition window.
 */

// Ensure the activity modules are loaded for this window.
ChromeUtils.import("resource:///modules/activity/activityModules.js");
ChromeUtils.import("resource:///modules/attachmentChecker.js");
ChromeUtils.import("resource:///modules/cloudFileAccounts.js");
ChromeUtils.import("resource:///modules/mimeParser.jsm");
ChromeUtils.import("resource:///modules/errUtils.js");
ChromeUtils.import("resource:///modules/folderUtils.jsm");
ChromeUtils.import("resource:///modules/iteratorUtils.jsm");
ChromeUtils.import("resource:///modules/mailServices.js");
ChromeUtils.import("resource:///modules/MailUtils.js");
ChromeUtils.import("resource://gre/modules/InlineSpellChecker.jsm");
ChromeUtils.import("resource://gre/modules/PluralForm.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.import("resource://gre/modules/AppConstants.jsm");

ChromeUtils.defineModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
ChromeUtils.defineModuleGetter(this, "ShortcutUtils",
                               "resource://gre/modules/ShortcutUtils.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  LightweightThemeManager: "resource://gre/modules/LightweightThemeManager.jsm",
});

Components.utils.import("resource:///modules/cm2TestImapM2.jsm");

/**
 * interfaces
 */
var nsIMsgCompDeliverMode = Ci.nsIMsgCompDeliverMode;
var nsIMsgCompSendFormat = Ci.nsIMsgCompSendFormat;
var nsIMsgCompConvertible = Ci.nsIMsgCompConvertible;
var nsIMsgCompType = Ci.nsIMsgCompType;
var nsIMsgCompFormat = Ci.nsIMsgCompFormat;
var nsIAbPreferMailFormat = Ci.nsIAbPreferMailFormat;
var nsIPlaintextEditorMail = Ci.nsIPlaintextEditor;
var nsISupportsString = Ci.nsISupportsString;
var mozISpellCheckingEngine = Ci.mozISpellCheckingEngine;

var sDictCount = 0;

/**
 * Global message window object. This is used by mail-offline.js and therefore
 * should not be renamed. We need to avoid doing this kind of cross file global
 * stuff in the future and instead pass this object as parameter when needed by
 * functions in the other js file.
 */
var msgWindow;

var gMessenger;

var gSpellChecker = new InlineSpellChecker();

/**
 * Global variables, need to be re-initialized every time mostly because
 * we need to release them when the window closes.
 */
var gMsgCompose;
var gOriginalMsgURI;
var gWindowLocked;
var gSendLocked;
var gContentChanged;
var gSubjectChanged;
var gAutoSaving;
var gCurrentIdentity;
var defaultSaveOperation;
var gSendOperationInProgress;
var gSaveOperationInProgress;
var gCloseWindowAfterSave;
var gSavedSendNowKey;
var gSendFormat;

var gMsgIdentityElement;
var gMsgAddressingWidgetTreeElement;
var gMsgSubjectElement;
var gMsgAttachmentElement;
var gMsgHeadersToolbarElement;
// TODO: Maybe the following two variables can be combined.
var gManualAttachmentReminder;
var gDisableAttachmentReminder;
var gComposeType;
var gLanguageObserver;
var gBodyFromArgs;

// i18n globals
var gCharsetConvertManager;
var _gComposeBundle;
function getComposeBundle() {
  // That one has to be lazy. Getting a reference to an element with a XBL
  // binding attached will cause the XBL constructors to fire if they haven't
  // already. If we get a reference to the compose bundle at script load-time,
  // this will cause the XBL constructor that's responsible for the personas to
  // fire up, thus executing the personas code while the DOM is not fully built.
  // Since this <script> comes before the <statusbar>, the Personas code will
  // fail.
  if (!_gComposeBundle)
    _gComposeBundle = document.getElementById("bundle_composeMsgs");
  return _gComposeBundle;
}

var gLastWindowToHaveFocus;
var gReceiptOptionChanged;
var gDSNOptionChanged;
var gAttachVCardOptionChanged;

var gAutoSaveInterval;
var gAutoSaveTimeout;
var gAutoSaveKickedIn;
var gEditingDraft;
var gAttachmentsSize;
var gNumUploadingAttachments;

var kComposeAttachDirPrefName = "mail.compose.attach.dir";

function InitializeGlobalVariables()
{
  gMessenger = Cc["@mozilla.org/messenger;1"]
                 .createInstance(Ci.nsIMessenger);

  gMsgCompose = null;
  gOriginalMsgURI = null;
  gWindowLocked = false;
  gContentChanged = false;
  gSubjectChanged = false;
  gCurrentIdentity = null;
  defaultSaveOperation = "draft";
  gSendOperationInProgress = false;
  gSaveOperationInProgress = false;
  gAutoSaving = false;
  gCloseWindowAfterSave = false;
  gSavedSendNowKey = null;
  gSendFormat = nsIMsgCompSendFormat.AskUser;
  gCharsetConvertManager = Cc['@mozilla.org/charset-converter-manager;1'].getService(Ci.nsICharsetConverterManager);
  gManualAttachmentReminder = false;
  gDisableAttachmentReminder = false;
  gLanguageObserver = null;

  gLastWindowToHaveFocus = null;
  gReceiptOptionChanged = false;
  gDSNOptionChanged = false;
  gAttachVCardOptionChanged = false;
  gAttachmentsSize = 0;
  gNumUploadingAttachments = 0;
  msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"]
                .createInstance(Ci.nsIMsgWindow);
  MailServices.mailSession.AddMsgWindow(msgWindow);
}
InitializeGlobalVariables();

function ReleaseGlobalVariables()
{
  gCurrentIdentity = null;
  gCharsetConvertManager = null;
  gMsgCompose = null;
  gOriginalMsgURI = null;
  gMessenger = null;
  gDisableAttachmentReminder = false;
  _gComposeBundle = null;
  MailServices.mailSession.RemoveMsgWindow(msgWindow);
  msgWindow = null;
}

/**
 * Get a pretty, human-readable shortcut key string from a given <key> id.
 *
 * @param aKeyId   the ID of a <key> element
 * @return string  pretty, human-readable shortcut key string from the <key>
 */
function getPrettyKey(aKeyId) {
  return ShortcutUtils.prettifyShortcut(document.getElementById(aKeyId));
}

/**
 * Disables or enables editable elements in the window.
 * The elements to operate on are marked with the "disableonsend" attribute.
 * This includes elements like the address list, attachment list, subject
 * and message body.
 *
 * @param aDisable  true = disable items. false = enable items.
 */
function updateEditableFields(aDisable)
{
  if (!gMsgCompose)
    return;

  if (aDisable)
    gMsgCompose.editor.flags |= nsIPlaintextEditorMail.eEditorReadonlyMask;
  else
    gMsgCompose.editor.flags &= ~nsIPlaintextEditorMail.eEditorReadonlyMask;

  let elements = document.querySelectorAll('[disableonsend="true"]');
  for (let i = 0; i < elements.length; i++)
    elements[i].disabled = aDisable;
}

var PrintPreviewListener = {
  getPrintPreviewBrowser: function() {
    let browser = document.getElementById("cppBrowser");
    if (!gChromeState)
      gChromeState = new Object;
    preparePrintPreviewTitleHeader();
    if (!browser) {
      browser = document.createElement("browser");
      browser.setAttribute("id", "cppBrowser");
      browser.setAttribute("flex", "1");
      browser.setAttribute("disablehistory", "true");
      browser.setAttribute("type", "content");
      document.getElementById("headers-parent").
        insertBefore(browser, document.getElementById("appcontent"));
    }
    return browser;
  },
  getSourceBrowser: function() {
    return GetCurrentEditorElement();
  },
  getNavToolbox: function() {
    return document.getElementById("compose-toolbox");
  },
  onEnter: function() {
    toggleAffectedChrome(true);
  },
  onExit: function() {
    document.getElementById("cppBrowser").collapsed = true;
    toggleAffectedChrome(false);
  }
}

function sidebar_is_hidden() {
  let sidebar_box = document.getElementById("sidebar-box");
  return sidebar_box.getAttribute("hidden") == "true";
}

function sidebar_is_collapsed() {
  let sidebar_splitter = document.getElementById("sidebar-splitter");
  return (sidebar_splitter &&
          sidebar_splitter.getAttribute("state") == "collapsed");
}

function SidebarSetState(aState) {
  document.getElementById("sidebar-box").hidden = aState != "visible";
  document.getElementById("sidebar-splitter").hidden = aState == "hidden";
}

function SidebarGetState() {
  if (sidebar_is_hidden())
    return "hidden";
  if (sidebar_is_collapsed())
    return "collapsed";
  return "visible";
}

/**
 * Prepare title header for the print (preview) document.
 */
function preparePrintPreviewTitleHeader() {
  // For title header of print (preview), use message content document title
  // if existing, otherwise message subject. To apply the message subject,
  // we temporarily change the title of message content document before going
  // into print preview (workaround for bug 1396455).
  let msgDocument = getBrowser().contentDocument;
  let msgSubject = GetMsgSubjectElement().value.trim() ||
                   getComposeBundle().getString("defaultSubject");
  gChromeState.msgDocumentHadTitle = !!msgDocument.querySelector('title');
  gChromeState.msgDocumentTitle = msgDocument.title;
  msgDocument.title = msgDocument.title || msgSubject;
}

/**
 * When going in and out of Print Preview, hide or show respective UI elements.
 *
 * @param aHide  true:  Hide UI elements to go into print preview mode.
 *               false: Restore UI elements to their previous state to exit
 *                      print preview mode.
 */
function toggleAffectedChrome(aHide)
{
  // Chrome to toggle includes:
  //   (*) menubar
  //   (*) toolbox
  //   (*) message headers box
  //   (*) sidebar
  //   (*) statusbar
  let statusbar = document.getElementById("status-bar");

  // Contacts Sidebar states map as follows:
  //   hidden    => hide/show nothing
  //   collapsed => hide/show only the splitter
  //   shown     => hide/show the splitter and the box

  if (aHide)
  {
    // Going into print preview mode.
    SetComposeWindowTitle(true);
    // Hide headers box, Contacts Sidebar, and Status Bar
    // after remembering their current state where applicable.
    document.getElementById("headers-box").hidden = true;
    gChromeState.sidebar = SidebarGetState();
    SidebarSetState("hidden");
    gChromeState.statusbarWasHidden = statusbar.hidden;
    statusbar.hidden = true;
  }
  else
  {
    // Restoring normal mode (i.e. leaving print preview mode).
    SetComposeWindowTitle();
    // Restore original "empty" HTML document title of the message, or remove
    // the temporary title tag altogether if there was none before.
    let msgDocument = getBrowser().contentDocument;
    if (!gChromeState.msgDocumentHadTitle) {
      msgDocument.querySelector('title').remove();
    } else {
      msgDocument.title = gChromeState.msgDocumentTitle;
    }

    // Restore Contacts Sidebar, headers box, and Status Bar.
    SidebarSetState(gChromeState.sidebar);
    document.getElementById("headers-box").hidden = false;
    statusbar.hidden = gChromeState.statusbarWasHidden;
  }

  document.getElementById("compose-toolbox").hidden = aHide;
  document.getElementById("appcontent").collapsed = aHide;
}

/**
 * Small helper function to check whether the node passed in is a signature.
 * Note that a text node is not a DOM element, hence .localName can't be used.
 */
function isSignature(aNode) {
  return ["DIV","PRE"].includes(aNode.nodeName) &&
         aNode.classList.contains("moz-signature");
}

var stateListener = {
  NotifyComposeFieldsReady: function() {
    ComposeFieldsReady();
    updateSendCommands(true);
  },

  NotifyComposeBodyReady: function() {
    // Look all the possible compose types (nsIMsgComposeParams.idl):
    switch (gComposeType) {

    case Ci.nsIMsgCompType.MailToUrl:
      gBodyFromArgs = true;
    case Ci.nsIMsgCompType.New:
    case Ci.nsIMsgCompType.NewsPost:
    case Ci.nsIMsgCompType.ForwardAsAttachment:
      this.NotifyComposeBodyReadyNew();
      break;

    case Ci.nsIMsgCompType.Reply:
    case Ci.nsIMsgCompType.ReplyAll:
    case Ci.nsIMsgCompType.ReplyToSender:
    case Ci.nsIMsgCompType.ReplyToGroup:
    case Ci.nsIMsgCompType.ReplyToSenderAndGroup:
    case Ci.nsIMsgCompType.ReplyWithTemplate:
    case Ci.nsIMsgCompType.ReplyToList:
      this.NotifyComposeBodyReadyReply();
      break;

    case Ci.nsIMsgCompType.ForwardInline:
      this.NotifyComposeBodyReadyForwardInline();
      break;

    case Ci.nsIMsgCompType.EditTemplate:
      defaultSaveOperation = "template";
    case Ci.nsIMsgCompType.Draft:
    case Ci.nsIMsgCompType.Template:
    case Ci.nsIMsgCompType.Redirect:
    case Ci.nsIMsgCompType.EditAsNew:
      break;

    default:
      dump("Unexpected nsIMsgCompType in NotifyComposeBodyReady (" +
           gComposeType + ")\n");
    }

    // Setting the selected item in the identity list will cause an
    // identity/signature switch. This can only be done once the message
    // body has already been assembled with the signature we need to switch.
    if (gMsgCompose.identity != gCurrentIdentity) {
      // Since switching the signature loses the caret position, we record it
      // and restore it later.
      let editor = GetCurrentEditor();
      let selection = editor.selection;
      let range = selection.getRangeAt(0);
      let start = range.startOffset;
      let startNode = range.startContainer;

      editor.enableUndo(false);
      let identityList = GetMsgIdentityElement();
      identityList.selectedItem = identityList.getElementsByAttribute(
        "identitykey", gMsgCompose.identity.key)[0];
      LoadIdentity(false);

      editor.enableUndo(true);
      editor.resetModificationCount();
      selection.collapse(startNode, start);
    }
    if (gMsgCompose.composeHTML)
      loadHTMLMsgPrefs();
    AdjustFocus();
  },

  NotifyComposeBodyReadyNew: function() {
    let useParagraph = Services.prefs.getBoolPref("mail.compose.default_to_paragraph");
    let insertParagraph = gMsgCompose.composeHTML && useParagraph;

    let mailBody = getBrowser().contentDocument.querySelector("body");
    if (insertParagraph && gBodyFromArgs) {
      // Check for "empty" body before allowing paragraph to be inserted.
      // Non-empty bodies in a new message can occur when clicking on a
      // mailto link or when using the command line option -compose.
      // An "empty" body can be one of these two cases:
      // 1) <br> and nothing follows (no next sibling)
      // 2) <div/pre class="moz-signature">
      // Note that <br><div/pre class="moz-signature"> doesn't happen in
      // paragraph mode.
      let firstChild = mailBody.firstChild;
      if ((firstChild.nodeName != "BR" || firstChild.nextSibling) &&
          !isSignature(firstChild))
        insertParagraph = false;
    }

    // Control insertion of line breaks.
    if (insertParagraph) {
      let editor = GetCurrentEditor();
      editor.enableUndo(false);

      editor.selection.collapse(mailBody, 0);
      let pElement = editor.createElementWithDefaults("p");
      pElement.appendChild(editor.createElementWithDefaults("br"));
      editor.insertElementAtSelection(pElement, false);

      document.getElementById("cmd_paragraphState").setAttribute("state", "p");

      editor.beginningOfDocument();
      editor.enableUndo(true);
      editor.resetModificationCount();
    } else {
      document.getElementById("cmd_paragraphState").setAttribute("state", "");
    }
  },

  NotifyComposeBodyReadyReply: function() {
    // Control insertion of line breaks.
    let useParagraph = Services.prefs.getBoolPref("mail.compose.default_to_paragraph");
    if (gMsgCompose.composeHTML && useParagraph) {
      let mailBody = getBrowser().contentDocument.querySelector("body");
      let editor = GetCurrentEditor();
      let selection = editor.selection;

      // Make sure the selection isn't inside the signature.
      if (isSignature(mailBody.firstChild))
        selection.collapse(mailBody, 0);

      let range = selection.getRangeAt(0);
      let start = range.startOffset;

      if (start != range.endOffset) {
        // The selection is not collapsed, most likely due to the
        // "select the quote" option. In this case we do nothing.
        return;
      }

      if (range.startContainer != mailBody) {
        dump("Unexpected selection in NotifyComposeBodyReadyReply\n");
        return;
      }

      editor.enableUndo(false);

      let pElement = editor.createElementWithDefaults("p");
      pElement.appendChild(editor.createElementWithDefaults("br"));
      editor.insertElementAtSelection(pElement, false);

      // Position into the paragraph.
      selection.collapse(pElement, 0);

      document.getElementById("cmd_paragraphState").setAttribute("state", "p");

      editor.enableUndo(true);
      editor.resetModificationCount();
    } else {
      document.getElementById("cmd_paragraphState").setAttribute("state", "");
    }
  },

  NotifyComposeBodyReadyForwardInline: function() {
    let mailBody = getBrowser().contentDocument.querySelector("body");
    let editor = GetCurrentEditor();
    let selection = editor.selection;

    editor.enableUndo(false);

    // Control insertion of line breaks.
    selection.collapse(mailBody, 0);
    let useParagraph = Services.prefs.getBoolPref("mail.compose.default_to_paragraph");
    if (gMsgCompose.composeHTML && useParagraph) {
      let pElement = editor.createElementWithDefaults("p");
      let brElement = editor.createElementWithDefaults("br");
      pElement.appendChild(brElement);
      editor.insertElementAtSelection(pElement, false);
      document.getElementById("cmd_paragraphState").setAttribute("state", "p");
    } else {
      // insertLineBreak() has been observed to insert two <br> elements
      // instead of one before a <div>, so we'll do it ourselves here.
      let brElement = editor.createElementWithDefaults("br");
      editor.insertElementAtSelection(brElement, false);
      document.getElementById("cmd_paragraphState").setAttribute("state", "");
    }

    editor.beginningOfDocument();
    editor.enableUndo(true);
    editor.resetModificationCount();
  },

  ComposeProcessDone: function(aResult) {
    ToggleWindowLock(false);

    if (aResult== Cr.NS_OK)
    {
      if (!gAutoSaving)
        SetContentAndBodyAsUnmodified();

      if (gCloseWindowAfterSave)
      {
        // Notify the SendListener that Send has been aborted and Stopped
        if (gMsgCompose)
          gMsgCompose.onSendNotPerformed(null, Cr.NS_ERROR_ABORT);

        MsgComposeCloseWindow();
      }
    }
    // else if we failed to save, and we're autosaving, need to re-mark the editor
    // as changed, so that we won't lose the changes.
    else if (gAutoSaving)
    {
      gMsgCompose.bodyModified = true;
      gContentChanged = true;
    }
    gAutoSaving = false;
    gCloseWindowAfterSave = false;
  },

  SaveInFolderDone: function(folderURI) {
    DisplaySaveFolderDlg(folderURI);
  }
};

var gSendListener = {
  // nsIMsgSendListener
  onStartSending: function (aMsgID, aMsgSize) {},
  onProgress: function (aMsgID, aProgress, aProgressMax) {},
  onStatus: function (aMsgID, aMsg) {},
  onStopSending: function (aMsgID, aStatus, aMsg, aReturnFile) {
    if (Components.isSuccessCode(aStatus))
      Services.obs.notifyObservers(null, "mail:composeSendSucceeded");
  },
  onGetDraftFolderURI: function (aFolderURI) {},
  onSendNotPerformed: function (aMsgID, aStatus) {},
};

// all progress notifications are done through the nsIWebProgressListener implementation...
var progressListener = {
    onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_START)
      {
        document.getElementById('compose-progressmeter').setAttribute( "mode", "undetermined" );
        document.getElementById("statusbar-progresspanel").collapsed = false;
      }

      if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP)
      {
        gSendOperationInProgress = false;
        gSaveOperationInProgress = false;
        document.getElementById('compose-progressmeter').setAttribute( "mode", "normal" );
        document.getElementById('compose-progressmeter').setAttribute( "value", 0 );
        document.getElementById("statusbar-progresspanel").collapsed = true;
        document.getElementById('statusText').setAttribute('label', '');
      }
    },

    onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress)
    {
      // Calculate percentage.
      var percent;
      if ( aMaxTotalProgress > 0 )
      {
        percent = Math.round( (aCurTotalProgress*100)/aMaxTotalProgress );
        if ( percent > 100 )
          percent = 100;

        document.getElementById('compose-progressmeter').removeAttribute("mode");

        // Advance progress meter.
        document.getElementById('compose-progressmeter').setAttribute( "value", percent );
      }
      else
      {
        // Progress meter should be barber-pole in this case.
        document.getElementById('compose-progressmeter').setAttribute( "mode", "undetermined" );
      }
    },

    onLocationChange: function(aWebProgress, aRequest, aLocation, aFlags)
    {
      // we can ignore this notification
    },

    onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage)
    {
      // Looks like it's possible that we get call while the document has been already delete!
      // therefore we need to protect ourself by using try/catch
      try {
        let statusText = document.getElementById("statusText");
        if (statusText)
          statusText.setAttribute("label", aMessage);
      } catch (ex) {}
    },

    onSecurityChange: function(aWebProgress, aRequest, state)
    {
      // we can ignore this notification
    },

    QueryInterface : function(iid)
    {
      if (iid.equals(Ci.nsIWebProgressListener) ||
          iid.equals(Ci.nsISupportsWeakReference) ||
          iid.equals(Ci.nsISupports))
        return this;

      throw Cr.NS_NOINTERFACE;
    }
};

// #6282: implémentation du droit à la déconnexion
var alreadyAnswered = false;
function DeconnexionRights()
{  
  let now = new Date(Date.now());
  // Appelé au premier focus de la fenêtre d'écriture de mail
  if(!alreadyAnswered && (!IsOpenDay(now) || !IsOpenHour(now)))// && DeconnexionRightsUser())
  {
    alreadyAnswered = true;
    if(Services.prefs.getIntPref("mail.identity.timestamp_envoi_differe") != 0)
    {
      let date = new Date(Services.prefs.getIntPref("mail.identity.timestamp_envoi_differe")*1000);
      if(date > Date.now())
      {
        let delayDate = GetDateFromPrefs();
        SetSendDifDateAndDisplay(delayDate, true);
      }
      else
        AskOpenHours();
    }
    else
      AskOpenHours();
  }
}

function AskOpenHours()
{
  window.openDialog("chrome://courrielleur/content/openhours.xul",
                      "",
                      "chrome,center,titlebar,modal,width=460,height=370",
                      {composeWindow:top.window,
                       msgCompFields:gMsgCompose.compFields},window.self);
                       
  switch (window.status)
  {
    case "openhours_continue":
      break;
    case "openhours_enable":
      let date = GetNextWorkHour();
      Services.prefs.setIntPref("mail.identity.timestamp_envoi_differe", Math.floor(date/1000));
      SetSendDifDateAndDisplay(date);
      break;
    case "openhours_close":
      window.close();
      break;
    default:
      break;
  }
}

function OpenHoursContinue()
{
  window.arguments[1].status = "openhours_continue";
  window.close();
}
function OpenHoursActivate()
{
  window.arguments[1].status = "openhours_enable";
  window.close();
}
function OpenHoursClose()
{
  window.arguments[1].status = "openhours_close";
  window.close();
}

function GetDateDayName(date)
{
  var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return days[date.getDay()];
}

// #6282: implémentation du droit à la déconnexion - retourne true ou false en fonction de l'heure et du jour actuel
function IsOpenDay(date)
{
  try
  {
    // Paramétré par PACOME au format hh:mm-hh:mm-day/day/day/day
    let openHoursPrefValue = Services.prefs.getCharPref("mail.identity.openhours");
    if(openHoursPrefValue  === "none")
      return true;
    
    let openHoursHoursArray = openHoursPrefValue.split("-");
    let openHoursDaysArray = openHoursHoursArray[2].split("/");
    
    // Si le jour est actuel est ouvré
    if(openHoursDaysArray.includes(GetDateDayName(date)))
      return true;
    
    // Sinon
    return false;
  }
  catch(ex)
  {
    // Openhours n'est certainement pas au bon format, on ignore la preference
    return true;
  }
}
function IsOpenHour(date)
{
  try
  {
    // Paramétré par PACOME au format hh:mm-hh:mm-day/day/day/day
    let openHoursPrefValue = Services.prefs.getCharPref("mail.identity.openhours");

    if(openHoursPrefValue === "none")
      return true;
    
    let openHoursHoursArray = openHoursPrefValue.split("-");
    //let openHoursDaysArray = openHoursHoursArray[2].split("/");
    
    let hBegin = openHoursHoursArray[0].split(":")[0];
    let hEnd = openHoursHoursArray[1].split(":")[0];
    let mBegin = openHoursHoursArray[0].split(":")[1];
    let mEnd = openHoursHoursArray[1].split(":")[1];
    
    // Si on est avant l'heure de départ, ou après l'heure de fin
    if(date.getHours() < hBegin || date.getHours() > hEnd)
      return false;
    else
    {
      // Sinon si on est quelques minutes avant l'heure de départ
      if(date.getHours() == hBegin && date.getMinutes() < mBegin)
        return false;
      // Sinon si on est quelques minutes après l'heure de fin
      if(date.getHours() == hEnd && date.getMinutes() > mEnd)
        return false;
    }
    
    return true;
  }
  catch(ex)
  {
    // Openhours n'est certainement pas au bon format, on ignore la preference
    return true;
  }
}

// #6282: implémentation du droit à la déconnexion - retourne true si l'utilisateur fait partie du MTE
function DeconnexionRightsUser()
{
  let whitelist = Services.prefs.getCharPref("mail.workhours.whitelist").split(";");
  let blacklist = Services.prefs.getCharPref("mail.workhours.blacklist").split(";");
  let currentpath = Services.prefs.getCharPref("anais.anaismoz.chemincourant");
  let userDn = GetUserDnFromPath(currentpath);

  if(userDn.length != 0)
  {
    for (const whitedn of whitelist)
    {
      if(userDn.toLowerCase().includes(whitedn.toLowerCase()))
      {
        for (const blackdn of blacklist)
        {
          if(userDn.toLowerCase().includes(blackdn.toLowerCase()))
            return false;
        }
        return true;
      }
    }
  }
  return false;
}

// #6282 retourne le dn à partir d'un format http://xxx/ou=aaa,ou=bbb ....
function GetUserDnFromPath(currentpath)
{
  let splittedPath = currentpath.split("/");
  for (const pathValue of splittedPath)
  {
    if(pathValue.toLowerCase().includes("ou="))
      return pathValue;
  }
  return "";
}

function addDays(date, days)
{
  var result = new Date(date);
  result.setDate(result.getDate()+days);
  return result;
}

// #6282 retourne la prochaine date ouverte, appelé lorsque la date actuelle est fermée
function GetNextWorkHour()
{
  let now = new Date(Date.now());
  let nextOpenDate = new Date(Date.now());
  let safetyCounter = 0;

  let hBegin = Services.prefs.getCharPref("mail.identity.openhours").split("-")[0].split(":")[0];
  let hEnd = Services.prefs.getCharPref("mail.identity.openhours").split("-")[1].split(":")[0];
  let mBegin = Services.prefs.getCharPref("mail.identity.openhours").split("-")[0].split(":")[1];
  let mEnd = Services.prefs.getCharPref("mail.identity.openhours").split("-")[1].split(":")[1];

  // Si l'heure d'ouverture est passée, il faut forcément ajouter au moins un jour.
  if ((now.getHours() > hBegin) || (now.getHours() == hBegin && now.getMinutes() > mBegin))
    nextOpenDate = addDays(nextOpenDate, 1);

  // On ajoute des jours à la date actuelle tant qu'on n'est pas sur un jour ouvré
  while(!IsOpenDay(nextOpenDate))
  {
    nextOpenDate = addDays(nextOpenDate, 1);

    // Si on a bouclé plus de 10 fois, le paramètre est mauvais, on retourne la date actuelle
    safetyCounter++;
    if(safetyCounter > 10)
      return now;
  }

  // On positionne l'heure à l'ouverture
  nextOpenDate.setHours(parseInt(hBegin), parseInt(mBegin), 0);
  return nextOpenDate;
}

// #6165 Commande envoi différé
var sendDifDate = null;
function cmdSendDifButton()
{
  sendDifDate = GetDateFromPrefs();
  window.openDialog("chrome://courrielleur/content/envoi-differe.xul",
                    "",
                    "chrome,center,titlebar,modal,width=400,height=400",
                    {composeWindow:top.window,
                     msgCompFields:gMsgCompose.compFields},window.self,sendDifDate);
                     
  switch (parseInt(window.status))
  {
    case 0:
      // Annuler
      break;
    case 1:
      // Supprimer
      SetSendDifDateAndDisplay(null);
      break;
    default:
      // Différer
      SetSendDifDateAndDisplay(new Date(window.status*1000));
      break;
  }  
}

function SendDifLoad(date)
{
  window.arguments[1].status = 0;
  
  // Si on a une date de remise différée
  if(date != null && !isNaN(date))
  {
    // On affiche le bon texte
    document.getElementById("senddif-active").style.display = "block";
    document.getElementById("senddif-inactive").style.display = "none";
    
    // On charge la valeur de la date dans le label concerné
    document.getElementById("senddif-label").value = GetDisplayDate(date);

    // On positionne les valeurs des champs correctement
    let minutes = date.getMinutes() < 10 ? '0'+date.getMinutes() : date.getMinutes();
    let hours = date.getHours() < 10 ? '0'+date.getHours() : date.getHours();
    setElementValue("senddif-date", date);
    document.getElementById("senddif-hour").value = hours+":"+minutes;
    
    let remember_checkbox = document.getElementById("senddif-remember");
    if(Services.prefs.getIntPref("mail.identity.timestamp_envoi_differe") != 0)
      remember_checkbox.checked=true;
    else
    {
      remember_checkbox.checked=false;
      document.documentElement.getButton("extra1").disabled=true;
    }
  }
  else
  {
    // On affiche le bon texte
    document.getElementById("senddif-active").style.display = "none";
    document.getElementById("senddif-inactive").style.display = "block";
  }
}

// #6282: Factorisation pour implémentation du droit à la déconnexion
function SetSendDifDateAndDisplay(pDate)
{  
  sendDifDate = pDate;
  let btnSendDif = document.getElementById("button-send-dif");
  if(sendDifDate != null && !isNaN(sendDifDate))
  {
    btnSendDif.style.borderColor = "#5AC100";
    btnSendDif.style.borderWidth = "2px";
    btnSendDif.label = GetDisplayDate(sendDifDate);
  }
  else
  {
    btnSendDif.style.borderColor = "";
    btnSendDif.style.borderWidth = "0px";
    btnSendDif.label = "Différer";
  }
}

function SendDifEnable()
{
  var date = document.getElementById("senddif-date").value;
  var hour = document.getElementById("senddif-hour").value;
  date.setHours(hour.split(":")[0], hour.split(":")[1]);
  
  var maxdate = new Date(Date.now());
  maxdate.setDate(maxdate.getDate() + 30);
  
  // La date est invalide pour un envois différé
  if(date > maxdate)    
    alert("La remise différée de votre mail ne peut excéder le " + GetDisplayDate(maxdate) + ".");
  else if(date < Date.now())
    alert("La date/heure spécifiée est antérieure à la date actuelle.");
  else
  {
    let remember_checkbox = document.getElementById("senddif-remember");
    let isoDate = GetIsoDate(date);
    let timeStamp = Math.floor((new Date(isoDate))/1000);
    
    if(remember_checkbox.checked)
      Services.prefs.setIntPref("mail.identity.timestamp_envoi_differe", timeStamp);
    else
      Services.prefs.setIntPref("mail.identity.timestamp_envoi_differe", 0);
    
    window.arguments[1].status = timeStamp;
    window.close();
  }
}

function SendDifTemporaryRemove()
{
  window.arguments[1].status = 1;
  window.close();
}

function SendDifRemove()
{
  Services.prefs.setIntPref("mail.identity.timestamp_envoi_differe", 0);
  window.arguments[1].status = 1;
  window.close();
}

function GetIsoDate(date)
{
  let monthtmp = date.getMonth()+1;
  let day = date.getDate() < 10 ? '0'+date.getDate() : date.getDate();
  let month = monthtmp < 10 ? '0'+monthtmp : monthtmp;
  let year = date.getFullYear();
  let minutes = date.getMinutes() < 10 ? '0'+date.getMinutes() : date.getMinutes();
  let hours = date.getHours() < 10 ? '0'+date.getHours() : date.getHours();
  
  let newDate = year+"-" +month+"-"+day+" "+hours+":"+minutes+":"+date.getSeconds();
  return newDate;
}

function GetDisplayDate(date)
{ 
  let monthtmp = date.getMonth()+1;
  let day = date.getDate() < 10 ? '0'+date.getDate() : date.getDate();
  let month = monthtmp < 10 ? '0'+monthtmp : monthtmp;
  let year = date.getFullYear();
  let minutes = date.getMinutes() < 10 ? '0'+date.getMinutes() : date.getMinutes();
  let hours = date.getHours() < 10 ? '0'+date.getHours() : date.getHours();
  
  let newDate = day+"/"+month+"/"+year+" "+hours+":"+minutes;
  return newDate;
}

function GetDateFromPrefs()
{
  try
  {
    let pref = Services.prefs.getIntPref("mail.identity.timestamp_envoi_differe");
    if(pref != 0)
    {
      let date = new Date(pref*1000);
      if(date < Date.now())
      {
        Services.prefs.setIntPref("mail.identity.timestamp_envoi_differe", 0);
        return GetDefaultDifDate();
      }
      else
        return date;
    }
    else
      return GetDefaultDifDate();
  }
  catch(ex)
  {
    return GetDefaultDifDate();
  }
}

function GetDefaultDifDate()
{
  let defaultDate = new Date(Date.now());
  if(defaultDate.getMinutes() < 20)
  {
    defaultDate.setMinutes(30);
  }
  else
  {
    defaultDate.setHours(defaultDate.getHours()+1);
    defaultDate.setMinutes(0);
  }
  return defaultDate;
}

var defaultController = {
  commands: {
    cmd_attachFile: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        AttachFile();
      }
    },

    cmd_attachCloud: {
      isEnabled: function() {
        // Hide the command entirely if there are no cloud accounts or
        // the feature is disbled.
        let cmd = document.getElementById("cmd_attachCloud");
        cmd.hidden = !Services.prefs.getBoolPref("mail.cloud_files.enabled") ||
                     (cloudFileAccounts.accounts.length == 0) ||
                     Services.io.offline;
        return !cmd.hidden && !gWindowLocked;
      },
      doCommand: function() {
        // We should never actually call this, since the <command> node calls
        // a different function.
      }
    },

    cmd_attachPage: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        AttachPage();
      }
    },

    cmd_toggleAttachmentPane: {
      isEnabled: function() {
        let cmdToggleAttachmentPane =
          document.getElementById("cmd_toggleAttachmentPane");
        let bucket = GetMsgAttachmentElement();
        let paneShown = !document.getElementById("attachments-box").collapsed;
        if (!paneShown) {
          cmdToggleAttachmentPane.setAttribute("checked", "false");
        } else {
          cmdToggleAttachmentPane.setAttribute("checked", "true");
        }

        // Enable this command when the compose window isn't locked.
        return !gWindowLocked;
      },
      doCommand: function() {
        toggleAttachmentPane();
      }
    },

    cmd_reorderAttachments: {
      isEnabled: function() {
        if (attachmentsCount() == 0) {
          let reorderAttachmentsPanel =
            document.getElementById("reorderAttachmentsPanel");
          if (reorderAttachmentsPanel.state == "open") {
            // When the panel is open and all attachments get deleted,
            // we get notified here and want to close the panel.
            reorderAttachmentsPanel.hidePopup();
          }
        }
        return (attachmentsCount() > 1);
      },
      doCommand: function() {
        showReorderAttachmentsPanel();
      }
    },

    cmd_removeAllAttachments: {
      isEnabled: function() {
        return !gWindowLocked && attachmentsCount() > 0;
      },
      doCommand: function() {
        RemoveAllAttachments();
      }
    },

    cmd_close: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandClose();
      }
    },

    cmd_saveDefault: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        Save();
      }
    },

    cmd_saveAsFile: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsFile(true);
      }
    },

    cmd_saveAsDraft: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsDraft();
      }
    },

    cmd_saveAsTemplate: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsTemplate();
      }
    },

    cmd_sendButton: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        if (Services.io.offline)
          SendMessageLater();
        else
          SendMessage();
      }
    },

    cmd_sendNow: {
      isEnabled: function() {
        return !gWindowLocked && !Services.io.offline && !gSendLocked &&
               !gNumUploadingAttachments;
      },
      doCommand: function() {
        SendMessage();
      }
    },

    cmd_sendLater: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        SendMessageLater();
      }
    },

    cmd_sendWithCheck: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        SendMessageWithCheck();
      }
    },

    cmd_printSetup: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        PrintUtils.showPageSetup();
      }
    },

    cmd_print: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandPrint();
      }
    },

    cmd_printPreview: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandPrintPreview();
      }
    },

    cmd_delete: {
      isEnabled: function() {
        let cmdDelete = document.getElementById("cmd_delete");
        let textValue = cmdDelete.getAttribute("valueDefault");
        let accesskeyValue = cmdDelete.getAttribute("valueDefaultAccessKey");

        cmdDelete.setAttribute("label", textValue);
        cmdDelete.setAttribute("accesskey", accesskeyValue);

        return false;
      },
      doCommand: function() {
      }
    },

    cmd_account: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        let currentAccountKey = getCurrentAccountKey();
        let account = MailServices.accounts.getAccount(currentAccountKey);
        MsgAccountManager(null, account.incomingServer);
      }
    },

    cmd_showFormatToolbar: {
      isEnabled: function() {
        return gMsgCompose && gMsgCompose.composeHTML;
      },
      doCommand: function() {
        goToggleToolbar("FormatToolbar", "menu_showFormatToolbar");
      }
    },

    cmd_quoteMessage: {
      isEnabled: function() {
        let selectedURIs = GetSelectedMessages();
        return (selectedURIs && selectedURIs.length > 0)
      },
      doCommand: function() {
        QuoteSelectedMessage();
      }
    },

    cmd_fullZoomReduce: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.reduce();
      }
    },

    cmd_fullZoomEnlarge: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.enlarge();
      }
    },

    cmd_fullZoomReset: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.reset();
      }
    },

    cmd_spelling: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        window.cancelSendMessage = false;
        var skipBlockQuotes =
          (window.document.documentElement.getAttribute("windowtype") ==
          "msgcompose");
        window.openDialog("chrome://editor/content/EdSpellCheck.xul", "_blank",
                          "dialog,close,titlebar,modal,resizable",
                          false, skipBlockQuotes, true);
      }
    },

    cmd_fullZoomToggle: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.toggleZoom();
      }
    },
  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;
    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;
    var cmd = this.commands[aCommand];
    if (!cmd.isEnabled())
      return;
    cmd.doCommand();
  },

  onEvent: function(event) {},
};

var attachmentBucketController = {
  commands: {
    cmd_selectAll: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        document.getElementById("attachmentBucket").selectAll();
      }
    },

    cmd_delete: {
      isEnabled: function() {
        let selectedCount = attachmentsSelectedCount();
        let cmdDelete = document.getElementById("cmd_delete");
        let textValue = getComposeBundle().getString("removeAttachmentMsgs");
        textValue = PluralForm.get(selectedCount, textValue);
        let accesskeyValue = cmdDelete.getAttribute("valueRemoveAttachmentAccessKey");
        cmdDelete.setAttribute("label", textValue);
        cmdDelete.setAttribute("accesskey", accesskeyValue);

        return selectedCount > 0;
      },
      doCommand: function() {
        RemoveSelectedAttachment();
      }
    },

    cmd_openAttachment: {
      isEnabled: function() {
        return attachmentsSelectedCount() == 1;
      },
      doCommand: function() {
        OpenSelectedAttachment();
      }
    },

    cmd_renameAttachment: {
      isEnabled: function() {
        return attachmentsSelectedCount() == 1;
      },
      doCommand: function() {
        RenameSelectedAttachment();
      }
    },

    cmd_moveAttachmentUp: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 0 &&
               !attachmentsSelectionIsBlock("top");
      },
      doCommand: function() {
        moveSelectedAttachments("up");
      }
    },

    cmd_moveAttachmentDown: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 0 &&
               !attachmentsSelectionIsBlock("bottom");
      },
      doCommand: function() {
        moveSelectedAttachments("down");
      }
    },

    cmd_moveAttachmentBundleUp: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 1 &&
               !attachmentsSelectionIsBlock();
      },
      doCommand: function() {
        moveSelectedAttachments("bundleUp");
      }
    },

    cmd_moveAttachmentBundleDown: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 1 &&
               !attachmentsSelectionIsBlock();
      },
      doCommand: function() {
        moveSelectedAttachments("bundleDown");
      }
    },

    cmd_moveAttachmentTop: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 0 &&
               !attachmentsSelectionIsBlock("top");
      },
      doCommand: function() {
        moveSelectedAttachments("top");
      }
    },

    cmd_moveAttachmentBottom: {
      isEnabled: function() {
        return attachmentsSelectedCount() > 0 &&
               !attachmentsSelectionIsBlock("bottom");
      },
      doCommand: function() {
        moveSelectedAttachments("bottom");
      }
    },

    cmd_sortAttachmentsToggle: {
      isEnabled: function() {
        let attachmentsSelCount = attachmentsSelectedCount();
        let sortSelection;
        let currSortOrder;
        let isBlock;
        let btnAscending;
        let toggleCmd = document.getElementById("cmd_sortAttachmentsToggle");
        let toggleBtn = document.getElementById("btn_sortAttachmentsToggle");
        let sortDirection;
        let btnLabelAttr;

        if (attachmentsSelCount > 1 &&
            attachmentsSelCount < attachmentsCount()) {
          // Sort selected attachments only, which needs at least 2 of them,
          // but not all.
          sortSelection = true;
          currSortOrder = attachmentsSelectionGetSortOrder();
          isBlock = attachmentsSelectionIsBlock();
          // If current sorting is ascending AND it's a block; OR
          // if current sorting is descending AND it's NOT a block yet:
          // Offer toggle button face to sort descending.
          // In all other cases, offer toggle button face to sort ascending.
          btnAscending = !((currSortOrder == "ascending") && isBlock ||
                           (currSortOrder == "descending") && !isBlock);
          // Set sortDirection for toggleCmd, and respective button face.
          if (btnAscending) {
            sortDirection = "ascending";
            btnLabelAttr = "label-selection-AZ";
          } else {
            sortDirection = "descending";
            btnLabelAttr = "label-selection-ZA";
          }
        } else { // attachmentsSelectedCount() <= 1 or all attachments selected
          // Sort all attachments.
          sortSelection = false;
          currSortOrder = attachmentsGetSortOrder();
          btnAscending = !(currSortOrder == "ascending")
          // Set sortDirection for toggleCmd, and respective button face.
          if (btnAscending) {
            sortDirection = "ascending";
            btnLabelAttr = "label-AZ";
          } else {
            sortDirection = "descending";
            btnLabelAttr = "label-ZA";
          }
        }

        // Set the sort direction for toggleCmd.
        toggleCmd.setAttribute("sortdirection", sortDirection);
        // The button's icon is set dynamically via CSS involving the button's
        // sortdirection attribute, which is forwarded by the command.
        toggleBtn.setAttribute("label", toggleBtn.getAttribute(btnLabelAttr));

        return sortSelection ? !(currSortOrder == "equivalent" && isBlock)
                             : !(currSortOrder == "equivalent");
      },
      doCommand: function() {
        moveSelectedAttachments("toggleSort");
      }
    },

    cmd_convertCloud: {
      isEnabled: function() {
        // Hide the command entirely if Filelink is disabled, or if there are
        // no cloud accounts.
        let cmd = document.getElementById("cmd_convertCloud");

        cmd.hidden = (!Services.prefs.getBoolPref("mail.cloud_files.enabled") ||
                      cloudFileAccounts.accounts.length == 0) ||
                      Services.io.offline;
        if (cmd.hidden)
          return false;

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item.uploading)
            return false;
        }
        return true;
      },
      doCommand: function() {
        // We should never actually call this, since the <command> node calls
        // a different function.
      }
    },

    cmd_convertAttachment: {
      isEnabled: function() {
        if (!Services.prefs.getBoolPref("mail.cloud_files.enabled"))
          return false;

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item.uploading)
            return false;
        }
        return true;
      },
      doCommand: function() {
        convertSelectedToRegularAttachment();
      }
    },

    cmd_cancelUpload: {
      isEnabled: function() {
        let cmd = document.getElementById("composeAttachmentContext_cancelUploadItem");

        // If Filelink is disabled, hide this menuitem and bailout.
        if (!Services.prefs.getBoolPref("mail.cloud_files.enabled")) {
          cmd.hidden = true;
          return false;
        }

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item && item.uploading) {
            cmd.hidden = false;
            return true;
          }
        }

        // Hide the command entirely if the selected attachments aren't cloud
        // files.
        // For some reason, the hidden property isn't propagating from the cmd
        // to the menuitem.
        cmd.hidden = true;
        return false;
      },
      doCommand: function() {
        let fileHandler = Services.io.getProtocolHandler("file")
                                  .QueryInterface(Ci.nsIFileProtocolHandler);

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item && item.uploading) {
            let file = fileHandler.getFileFromURLSpec(item.attachment.url);
            item.cloudProvider.cancelFileUpload(file);
          }
        }
      },
    },
  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;
    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;
    var cmd = this.commands[aCommand];
    if (!cmd.isEnabled())
      return;
    cmd.doCommand();
  },

  onEvent: function(event) {},
};

/**
 * Start composing a new message.
 */
function goOpenNewMessage(aEvent)
{
  // If aEvent is passed, check if Shift key was pressed for composition in
  // non-default format (HTML vs. plaintext).
  let msgCompFormat = (aEvent && aEvent.shiftKey) ?
    Ci.nsIMsgCompFormat.OppositeOfDefault :
    Ci.nsIMsgCompFormat.Default;

  let identity = getCurrentIdentity();
  MailServices.compose.OpenComposeWindow(null, null, null,
    Ci.nsIMsgCompType.New,
    msgCompFormat, identity, null);
}

function QuoteSelectedMessage()
{
  var selectedURIs = GetSelectedMessages();
  if (selectedURIs)
    for (let i = 0; i < selectedURIs.length; i++)
      gMsgCompose.quoteMessage(selectedURIs[i]);
}

function GetSelectedMessages()
{
  let mailWindow = Services.wm.getMostRecentWindow("mail:3pane");
  return (mailWindow) ? mailWindow.gFolderDisplay.selectedMessageUris : null;
}

function SetupCommandUpdateHandlers()
{
  let attachmentBucket = document.getElementById("attachmentBucket");

  top.controllers.appendController(defaultController);
  attachmentBucket.controllers.appendController(attachmentBucketController);

  document.getElementById("optionsMenuPopup")
          .addEventListener("popupshowing", updateOptionItems, true);
}

function UnloadCommandUpdateHandlers()
{
  let attachmentBucket = document.getElementById("attachmentBucket");

  document.getElementById("optionsMenuPopup")
          .removeEventListener("popupshowing", updateOptionItems, true);

  attachmentBucket.controllers.removeController(attachmentBucketController);
  top.controllers.removeController(defaultController);
}

function CommandUpdate_MsgCompose()
{
  var focusedWindow = top.document.commandDispatcher.focusedWindow;

  // we're just setting focus to where it was before
  if (focusedWindow == gLastWindowToHaveFocus)
    return;

  gLastWindowToHaveFocus = focusedWindow;
  updateComposeItems();
}

function findbarFindReplace()
{
  SetMsgBodyFrameFocus();
  let findbar = document.getElementById("FindToolbar");
  findbar.close();
  goDoCommand("cmd_findReplace");
  findbar.open();
}

function updateComposeItems()
{
  try {
    // Edit Menu
    goUpdateCommand("cmd_rewrap");

    // Insert Menu
    if (gMsgCompose && gMsgCompose.composeHTML)
    {
      goUpdateCommand("cmd_renderedHTMLEnabler");
      goUpdateCommand("cmd_fontColor");
      goUpdateCommand("cmd_backgroundColor");
      goUpdateCommand("cmd_decreaseFontStep");
      goUpdateCommand("cmd_increaseFontStep");
      goUpdateCommand("cmd_bold");
      goUpdateCommand("cmd_italic");
      goUpdateCommand("cmd_underline");
      goUpdateCommand("cmd_ul");
      goUpdateCommand("cmd_ol");
      goUpdateCommand("cmd_indent");
      goUpdateCommand("cmd_outdent");
      goUpdateCommand("cmd_align");
      goUpdateCommand("cmd_smiley");
    }

    // Options Menu
    goUpdateCommand("cmd_spelling");

    // Workaround to update 'Quote' toolbar button. (See bug 609926.)
    goUpdateCommand("cmd_quoteMessage");
  } catch(e) {}
}

/**
 * Disables or restores all toolbar items (menus/buttons) in the window.
 *
 * @param aDisable  true = disable all items. false = restore items to the state
 *                  stored before disabling them.
 */
function updateAllItems(aDisable)
{
  function getDisabledState(aElement) {
    if ("disabled" in aElement)
      return (aElement.disabled ? "true" : "false");
    else if (!aElement.hasAttribute("disabled"))
      return "";
    else
      return aElement.getAttribute("disabled");
  }

  function setDisabledState(aElement, aValue) {
    if ("disabled" in aElement)
      aElement.disabled = (aValue == "true");
    else if (aValue == "")
      aElement.removeAttribute("disabled");
    else
      aElement.setAttribute("disabled", aValue);
  }


  // This array will contain HTMLCollection objects as members.
  let commandItemCollections = [];
  commandItemCollections.push(document.getElementsByTagName("menu"));
  commandItemCollections.push(document.getElementsByTagName("toolbarbutton"));
  commandItemCollections.push(document.querySelectorAll('[command]'));
  commandItemCollections.push(document.querySelectorAll('[oncommand]'));
  for (let itemCollection of commandItemCollections) {
    for (let item = 0; item < itemCollection.length; item++) {
      let commandItem = itemCollection[item];
      if (aDisable) {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if we didn't already set the "stateBeforeSend"
        // attribute on previous visit.
        if (!commandItem.hasAttribute("stateBeforeSend")) {
          commandItem.setAttribute("stateBeforeSend", getDisabledState(commandItem));
          setDisabledState(commandItem, true);
        }
      }
      else {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if it still has the "stateBeforeSend"
        // attribute.
        if (commandItem.hasAttribute("stateBeforeSend")) {
          setDisabledState(commandItem, commandItem.getAttribute("stateBeforeSend"));
          commandItem.removeAttribute("stateBeforeSend");
        }
      }
    }
  }
}

function InitFileSaveAsMenu()
{
  document.getElementById("cmd_saveAsFile")
          .setAttribute("checked", defaultSaveOperation == "file");
  document.getElementById("cmd_saveAsDraft")
          .setAttribute("checked", defaultSaveOperation == "draft");
  document.getElementById("cmd_saveAsTemplate")
          .setAttribute("checked", defaultSaveOperation == "template");
}

function openEditorContextMenu(popup)
{
  gSpellChecker.clearSuggestionsFromMenu();
  gSpellChecker.initFromEvent(document.popupRangeParent, document.popupRangeOffset);
  var onMisspelling = gSpellChecker.overMisspelling;
  document.getElementById('spellCheckSuggestionsSeparator').hidden = !onMisspelling;
  document.getElementById('spellCheckAddToDictionary').hidden = !onMisspelling;
  document.getElementById('spellCheckIgnoreWord').hidden = !onMisspelling;
  var separator = document.getElementById('spellCheckAddSep');
  separator.hidden = !onMisspelling;
  document.getElementById('spellCheckNoSuggestions').hidden = !onMisspelling ||
      gSpellChecker.addSuggestionsToMenu(popup, separator, 5);

  // We ought to do that, otherwise changing dictionaries will have no effect!
  // InlineSpellChecker only registers callbacks for entries that are not the
  // current dictionary, so if we changed dictionaries in the meanwhile, we must
  // rebuild the list so that the right callbacks are registered in the Language
  // menu.
  gSpellChecker.clearDictionaryListFromMenu();
  let dictMenu = document.getElementById("spellCheckDictionariesMenu");
  let dictSep = document.getElementById("spellCheckLanguageSeparator");
  gSpellChecker.addDictionaryListToMenu(dictMenu, dictSep);

  updateEditItems();
}

function updateEditItems()
{
  goUpdateCommand("cmd_paste");
  goUpdateCommand("cmd_pasteNoFormatting");
  goUpdateCommand("cmd_pasteQuote");
  goUpdateCommand("cmd_delete");
  goUpdateCommand("cmd_renameAttachment");
  goUpdateCommand("cmd_reorderAttachments");
  goUpdateCommand("cmd_selectAll");
  goUpdateCommand("cmd_openAttachment");
  goUpdateCommand("cmd_findReplace");
  goUpdateCommand("cmd_find");
  goUpdateCommand("cmd_findNext");
  goUpdateCommand("cmd_findPrev");
}

function updateViewItems()
{
  goUpdateCommand("cmd_toggleAttachmentPane");
}

function updateAttachmentItems()
{
  goUpdateCommand("cmd_toggleAttachmentPane");
  goUpdateCommand("cmd_attachCloud");
  goUpdateCommand("cmd_convertCloud");
  goUpdateCommand("cmd_convertAttachment");
  goUpdateCommand("cmd_cancelUpload");
  goUpdateCommand("cmd_delete");
  goUpdateCommand("cmd_removeAllAttachments");
  goUpdateCommand("cmd_renameAttachment");
  updateReorderAttachmentsItems();
  goUpdateCommand("cmd_selectAll");
  goUpdateCommand("cmd_openAttachment");
}

function updateReorderAttachmentsItems() {
  goUpdateCommand("cmd_reorderAttachments");
  goUpdateCommand("cmd_moveAttachmentUp");
  goUpdateCommand("cmd_moveAttachmentDown");
  goUpdateCommand("cmd_moveAttachmentBundleUp");
  goUpdateCommand("cmd_moveAttachmentBundleDown");
  goUpdateCommand("cmd_moveAttachmentTop");
  goUpdateCommand("cmd_moveAttachmentBottom");
  goUpdateCommand("cmd_sortAttachmentsToggle");
}

/**
 * Update all the commands for sending a message to reflect their current state.
 */
function updateSendCommands(aHaveController)
{
  updateSendLock();
  if (aHaveController) {
    goUpdateCommand("cmd_sendButton");
    goUpdateCommand("cmd_sendNow");
    goUpdateCommand("cmd_sendLater");
    goUpdateCommand("cmd_sendWithCheck");
  } else {
    goSetCommandEnabled("cmd_sendButton",    defaultController.isCommandEnabled("cmd_sendButton"));
    goSetCommandEnabled("cmd_sendNow",       defaultController.isCommandEnabled("cmd_sendNow"));
    goSetCommandEnabled("cmd_sendLater",     defaultController.isCommandEnabled("cmd_sendLater"));
    goSetCommandEnabled("cmd_sendWithCheck", defaultController.isCommandEnabled("cmd_sendWithCheck"));
  }
}

function addAttachCloudMenuItems(aParentMenu)
{
  while (aParentMenu.hasChildNodes())
    aParentMenu.lastChild.remove();

  for (let cloudProvider of cloudFileAccounts.accounts) {
    let item = document.createElement("menuitem");
    let iconClass = cloudProvider.iconClass;
    item.cloudProvider = cloudProvider;
    item.setAttribute("label", cloudFileAccounts.getDisplayName(cloudProvider));

    if (iconClass) {
      item.setAttribute("class", "menu-iconic");
      item.setAttribute("image", iconClass);
    }
    aParentMenu.appendChild(item);
  }
}

function addConvertCloudMenuItems(aParentMenu, aAfterNodeId, aRadioGroup)
{
  let attachment = document.getElementById("attachmentBucket").selectedItem;
  let afterNode = document.getElementById(aAfterNodeId);
  while (afterNode.nextSibling)
    afterNode.nextSibling.remove();

  if (!attachment.sendViaCloud) {
    let item = document.getElementById("convertCloudMenuItems_popup_convertAttachment");
    item.setAttribute("checked", "true");
  }

  for (let cloudProvider of cloudFileAccounts.accounts) {
    let item = document.createElement("menuitem");
    let iconClass = cloudProvider.iconClass;
    item.cloudProvider = cloudProvider;
    item.setAttribute("label", cloudFileAccounts.getDisplayName(cloudProvider));
    item.setAttribute("type", "radio");
    item.setAttribute("name", aRadioGroup);

    if (attachment.cloudProvider &&
        attachment.cloudProvider.accountKey == cloudProvider.accountKey) {
      item.setAttribute("checked", "true");
    }
    else if (iconClass) {
      item.setAttribute("class", "menu-iconic");
      item.setAttribute("image", iconClass);
    }

    aParentMenu.appendChild(item);
  }
}

function uploadListener(aAttachment, aFile, aCloudProvider)
{
  this.attachment = aAttachment;
  this.file = aFile;
  this.cloudProvider = aCloudProvider;

  // Notify the UI that we're starting the upload process: disable send commands
  // and show a "connecting" icon for the attachment.
  this.attachment.sendViaCloud = true;
  gNumUploadingAttachments++;
  updateSendCommands(true);

  let bucket = document.getElementById("attachmentBucket");
  let item = bucket.findItemForAttachment(this.attachment);
  if (item) {
    item.image = "chrome://messenger/skin/icons/connecting.png";
    item.setAttribute("tooltiptext",
      getComposeBundle().getFormattedString("cloudFileUploadingTooltip", [
        cloudFileAccounts.getDisplayName(this.cloudProvider)
      ]));
    item.uploading = true;
    item.cloudProvider = this.cloudProvider;
  }
}

uploadListener.prototype = {
  onStartRequest: function uploadListener_onStartRequest(aRequest, aContext) {
    let bucket = document.getElementById("attachmentBucket");
    let item = bucket.findItemForAttachment(this.attachment);
    if (item)
      item.image = "chrome://global/skin/icons/loading.png";
  },

  onStopRequest: function uploadListener_onStopRequest(aRequest, aContext,
                                                       aStatusCode) {
    let bucket = document.getElementById("attachmentBucket");
    let attachmentItem = bucket.findItemForAttachment(this.attachment);

    if (Components.isSuccessCode(aStatusCode)) {
      let originalUrl = this.attachment.url;
      this.attachment.contentLocation = this.cloudProvider.urlForFile(this.file);
      this.attachment.cloudProviderKey = this.cloudProvider.accountKey;
      if (attachmentItem) {
        // Update relevant bits on the attachment list item.
        if (!attachmentItem.originalUrl)
          attachmentItem.originalUrl = originalUrl;
        attachmentItem.setAttribute("tooltiptext",
          getComposeBundle().getFormattedString("cloudFileUploadedTooltip", [
            cloudFileAccounts.getDisplayName(this.cloudProvider)
          ]));
        attachmentItem.uploading = false;

        // Set the icon for the attachment.
        let iconClass = this.cloudProvider.iconClass;
        if (iconClass)
          attachmentItem.image = iconClass;
        else {
          // Should we use a generic "cloud" icon here? Or an overlay icon?
          // I think the provider should provide an icon, end of story.
          attachmentItem.image = null;
        }
      }

      let event = document.createEvent("Events");
      event.initEvent("attachment-uploaded", true, true);
      attachmentItem.dispatchEvent(new Event("attachment-uploaded",
        { bubbles: true, cancelable: true }));
    }
    else {
      let title;
      let msg;
      let displayName = cloudFileAccounts.getDisplayName(this.cloudProvider);
      let bundle = getComposeBundle();
      let displayError = true;
      switch (aStatusCode) {
      case Ci.nsIMsgCloudFileProvider.authErr:
        title = bundle.getString("errorCloudFileAuth.title");
        msg = bundle.getFormattedString("errorCloudFileAuth.message",
                                        [displayName]);
        break;
      case Ci.nsIMsgCloudFileProvider.uploadErr:
        title = bundle.getString("errorCloudFileUpload.title");
        msg = bundle.getFormattedString("errorCloudFileUpload.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case Ci.nsIMsgCloudFileProvider.uploadWouldExceedQuota:
        title = bundle.getString("errorCloudFileQuota.title");
        msg = bundle.getFormattedString("errorCloudFileQuota.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case Ci.nsIMsgCloudFileProvider.uploadExceedsFileNameLimit:
        title = bundle.getString("errorCloudFileNameLimit.title");
        msg = bundle.getFormattedString("errorCloudFileNameLimit.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case Ci.nsIMsgCloudFileProvider.uploadExceedsFileLimit:
        title = bundle.getString("errorCloudFileLimit.title");
        msg = bundle.getFormattedString("errorCloudFileLimit.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case Ci.nsIMsgCloudFileProvider.uploadCanceled:
        displayError = false;
        break;
      default:
        title = bundle.getString("errorCloudFileOther.title");
        msg = bundle.getFormattedString("errorCloudFileOther.message",
                                        [displayName]);
        break;
      }

      // TODO: support actions other than "Upgrade"
      if (displayError) {
        let url = this.cloudProvider.providerUrlForError(aStatusCode);
        let flags = Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_OK;
        if (url)
          flags += Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
        if (Services.prompt.confirmEx(window, title, msg, flags, null,
                                      bundle.getString("errorCloudFileUpgrade.label"),
                                      null, null, {})) {
          openLinkExternally(url);
        }
      }

      if (attachmentItem) {
        // Remove the loading throbber.
        attachmentItem.image = null;
        attachmentItem.setAttribute("tooltiptext", attachmentItem.attachment.url);
        attachmentItem.uploading = false;
        attachmentItem.attachment.sendViaCloud = false;
        delete attachmentItem.cloudProvider;

        let event = document.createEvent("CustomEvent");
        event.initEvent("attachment-upload-failed", true, true,
                        aStatusCode);
        attachmentItem.dispatchEvent(event);
      }
    }

    gNumUploadingAttachments--;
    updateSendCommands(true);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIRequestObserver,
                                         Ci.nsISupportsWeakReference])
};

function deletionListener(aAttachment, aCloudProvider)
{
  this.attachment = aAttachment;
  this.cloudProvider = aCloudProvider;
}

deletionListener.prototype = {
  onStartRequest: function deletionListener_onStartRequest(aRequest, aContext) {
  },

  onStopRequest: function deletionListener_onStopRequest(aRequest, aContext,
                                                         aStatusCode) {
    if (!Components.isSuccessCode(aStatusCode)) {
      let displayName = cloudFileAccounts.getDisplayName(this.cloudProvider);
      Services.prompt.alert(window,
        getComposeBundle().getString("errorCloudFileDeletion.title"),
        getComposeBundle().getFormattedString("errorCloudFileDeletion.message",
                                              [displayName,
                                               this.attachment.name]));
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIRequestObserver,
                                         Ci.nsISupportsWeakReference])
};

/**
 * Prompt the user for a list of files to attach via a cloud provider.
 *
 * @param aProvider the cloud provider to upload the files to
 */
function attachToCloud(aProvider)
{
  // We need to let the user pick local file(s) to upload to the cloud and
  // gather url(s) to those files.
  var fp = Cc["@mozilla.org/filepicker;1"]
             .createInstance(nsIFilePicker);
  fp.init(window, getComposeBundle().getFormattedString(
            "chooseFileToAttachViaCloud",
            [cloudFileAccounts.getDisplayName(aProvider)]),
          nsIFilePicker.modeOpenMultiple);

  var lastDirectory = GetLastAttachDirectory();
  if (lastDirectory)
    fp.displayDirectory = lastDirectory;

  let files = [];

  fp.appendFilters(nsIFilePicker.filterAll);
  fp.open(rv => {
    if (rv != nsIFilePicker.returnOK || !fp.files) {
      return;
    }

    let files = Array.from(fixIterator(fp.files,
                             Ci.nsIFile))
    let attachments = files.map(f => FileToAttachment(f));

    let i = 0;
    let items = AddAttachments(attachments, function(aItem) {
      let listener = new uploadListener(attachments[i], files[i], aProvider);
      try {
        aProvider.uploadFile(files[i], listener);
      }
      catch (ex) {
        listener.onStopRequest(null, null, ex.result);
      }
      i++;
    });

    dispatchAttachmentBucketEvent("attachments-uploading", attachments);
    SetLastAttachDirectory(files[files.length-1]);
  });
}

/**
 * Convert an array of attachments to cloud attachments.
 *
 * @param aItems an array of <attachmentitem>s containing the attachments in
 *        question
 * @param aProvider the cloud provider to upload the files to
 */
function convertListItemsToCloudAttachment(aItems, aProvider)
{
  // If we want to display an offline error message, we should do it here.
  // No sense in doing the delete and upload and having them fail.
  if (Services.io.offline)
    return;

  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Ci.nsIFileProtocolHandler);
  let convertedAttachments = Cc["@mozilla.org/array;1"]
                               .createInstance(Ci.nsIMutableArray);

  for (let item of aItems) {
    let url = item.attachment.url;

    if (item.attachment.sendViaCloud) {
      if (item.cloudProvider && item.cloudProvider == aProvider)
        continue;
      url = item.originalUrl;
    }

    let file = fileHandler.getFileFromURLSpec(url);
    if (item.cloudProvider) {
      item.cloudProvider.deleteFile(
        file, new deletionListener(item.attachment, item.cloudProvider));
    }

    try {
      let listener = new uploadListener(item.attachment, file,
                                        aProvider);
      aProvider.uploadFile(file, listener);
      convertedAttachments.appendElement(item.attachment);
    }
    catch (ex) {
      listener.onStopRequest(null, null, ex.result);
    }
  }

  if (convertedAttachments.length > 0) {
    dispatchAttachmentBucketEvent("attachments-converted", convertedAttachments);
    Services.obs.notifyObservers(convertedAttachments,
                                 "mail:attachmentsConverted",
                                 aProvider.accountKey);
  }
}

/**
 * Convert the selected attachments to cloud attachments.
 *
 * @param aProvider the cloud provider to upload the files to
 */
function convertSelectedToCloudAttachment(aProvider)
{
  let bucket = document.getElementById("attachmentBucket");
  convertListItemsToCloudAttachment([...bucket.selectedItems], aProvider);
}

/**
 * Convert an array of nsIMsgAttachments to cloud attachments.
 *
 * @param aAttachments an array of nsIMsgAttachments
 * @param aProvider the cloud provider to upload the files to
 */
function convertToCloudAttachment(aAttachments, aProvider)
{
  let bucket = document.getElementById("attachmentBucket");
  let items = [];
  for (let attachment of aAttachments) {
    let item = bucket.findItemForAttachment(attachment);
    if (item)
      items.push(item);
  }

  convertListItemsToCloudAttachment(items, aProvider);
}

/**
 * Convert an array of attachments to regular (non-cloud) attachments.
 *
 * @param aItems an array of <attachmentitem>s containing the attachments in
 *        question
 */
function convertListItemsToRegularAttachment(aItems)
{
  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Ci.nsIFileProtocolHandler);
  let convertedAttachments = Cc["@mozilla.org/array;1"]
                               .createInstance(Ci.nsIMutableArray);

  for (let item of aItems) {
    if (!item.attachment.sendViaCloud || !item.cloudProvider)
      continue;

    let file = fileHandler.getFileFromURLSpec(item.originalUrl);
    try {
      // This will fail for drafts, but we can still send the message
      // with a normal attachment.
      item.cloudProvider.deleteFile(
        file, new deletionListener(item.attachment, item.cloudProvider));
    }
    catch (ex) {
       Cu.reportError(ex);
    }

    item.attachment.url = item.originalUrl;
    item.setAttribute("tooltiptext", item.attachment.url);
    item.attachment.sendViaCloud = false;

    delete item.cloudProvider;
    delete item.originalUrl;
    item.image = null;

    convertedAttachments.appendElement(item.attachment);
  }

  dispatchAttachmentBucketEvent("attachments-converted", convertedAttachments);
  Services.obs.notifyObservers(convertedAttachments,
                               "mail:attachmentsConverted");

  // We leave the content location in for the notifications because
  // it may be needed to identify the attachment. But clear it out now.
  for (let item of aItems)
    delete item.attachment.contentLocation;
}

/**
 * Convert the selected attachments to regular (non-cloud) attachments.
 */
function convertSelectedToRegularAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  convertListItemsToRegularAttachment([...bucket.selectedItems]);
}

/**
 * Convert an array of nsIMsgAttachments to regular (non-cloud) attachments.
 *
 * @param aAttachments an array of nsIMsgAttachments
 */
function convertToRegularAttachment(aAttachments)
{
  let bucket = document.getElementById("attachmentBucket");
  let items = [];
  for (let attachment of aAttachments) {
    let item = bucket.findItemForAttachment(attachment);
    if (item)
      items.push(item);
  }

  convertListItemsToRegularAttachment(items);
}

function updateOptionItems()
{
  goUpdateCommand("cmd_quoteMessage");
}

/* messageComposeOfflineQuitObserver is notified whenever the network
 * connection status has switched to offline, or when the application
 * has received a request to quit.
 */
var messageComposeOfflineQuitObserver =
{
  observe: function(aSubject, aTopic, aData)
  {
    // sanity checks
    if (aTopic == "network:offline-status-changed")
    {
      MessageComposeOfflineStateChanged(Services.io.offline);
    }
    // check whether to veto the quit request (unless another observer already
    // did)
    else if (aTopic == "quit-application-requested"
        && (aSubject instanceof Ci.nsISupportsPRBool)
        && !aSubject.data)
      aSubject.data = !ComposeCanClose();
  }
}

function AddMessageComposeOfflineQuitObserver()
{
  Services.obs.addObserver(messageComposeOfflineQuitObserver,
                           "network:offline-status-changed");
  Services.obs.addObserver(messageComposeOfflineQuitObserver,
                           "quit-application-requested");

  // set the initial state of the send button
  MessageComposeOfflineStateChanged(Services.io.offline);
}

function RemoveMessageComposeOfflineQuitObserver()
{
  Services.obs.removeObserver(messageComposeOfflineQuitObserver,
                              "network:offline-status-changed");
  Services.obs.removeObserver(messageComposeOfflineQuitObserver,
                              "quit-application-requested");
}

function MessageComposeOfflineStateChanged(goingOffline)
{
  try {
    var sendButton = document.getElementById("button-send");
    var sendNowMenuItem = document.getElementById("menu-item-send-now");

    if (!gSavedSendNowKey) {
      gSavedSendNowKey = sendNowMenuItem.getAttribute('key');
    }

    // don't use goUpdateCommand here ... the defaultController might not be installed yet
    updateSendCommands(false);

    if (goingOffline)
    {
      sendButton.label = sendButton.getAttribute('later_label');
      sendButton.setAttribute('tooltiptext', sendButton.getAttribute('later_tooltiptext'));
      sendNowMenuItem.removeAttribute('key');
    }
    else
    {
      sendButton.label = sendButton.getAttribute('now_label');
      sendButton.setAttribute('tooltiptext', sendButton.getAttribute('now_tooltiptext'));
      if (gSavedSendNowKey) {
        sendNowMenuItem.setAttribute('key', gSavedSendNowKey);
      }
    }

  } catch(e) {}
}

function DoCommandClose()
{
  if (ComposeCanClose()) {

    // Notify the SendListener that Send has been aborted and Stopped
    if (gMsgCompose)
      gMsgCompose.onSendNotPerformed(null, Cr.NS_ERROR_ABORT);

    // This destroys the window for us.
    MsgComposeCloseWindow();
  }

  return false;
}

function DoCommandPrint()
{
  try {
    let editor = GetCurrentEditorElement();
    PrintUtils.printWindow(editor.outerWindowID, editor);
  } catch(ex) {dump("#PRINT ERROR: " + ex + "\n");}
}

function DoCommandPrintPreview()
{
  try {
    PrintUtils.printPreview(PrintPreviewListener);
    } catch(ex) { Cu.reportError(ex); }
}

/**
 * Locks/Unlocks the window widgets while a message is being saved/sent.
 * Locking means to disable all possible items in the window so that
 * the user can't click/activate anything.
 *
 * @param aDisable  true = lock the window. false = unlock the window.
 */
function ToggleWindowLock(aDisable)
{
  gWindowLocked = aDisable;
  updateAllItems(aDisable);
  updateEditableFields(aDisable);
  if (!aDisable)
    updateComposeItems();
}

/* This function will go away soon as now arguments are passed to the window using a object of type nsMsgComposeParams instead of a string */
function GetArgs(originalData)
{
  var args = new Object();

  if (originalData == "")
    return null;

  var data = "";
  var separator = String.fromCharCode(1);

  var quoteChar = "";
  var prevChar = "";
  var nextChar = "";
  for (let i = 0; i < originalData.length; i++, prevChar = aChar)
  {
    var aChar = originalData.charAt(i)
    var aCharCode = originalData.charCodeAt(i)
    if ( i < originalData.length - 1)
      nextChar = originalData.charAt(i + 1);
    else
      nextChar = "";

    if (aChar == quoteChar && (nextChar == "," || nextChar == ""))
    {
      quoteChar = "";
      data += aChar;
    }
    else if ((aCharCode == 39 || aCharCode == 34) && prevChar == "=") //quote or double quote
    {
      if (quoteChar == "")
        quoteChar = aChar;
      data += aChar;
    }
    else if (aChar == ",")
    {
      if (quoteChar == "")
        data += separator;
      else
        data += aChar
    }
    else
      data += aChar
  }

  var pairs = data.split(separator);
//  dump("Compose: argument: {" + data + "}\n");

  for (let i = pairs.length - 1; i >= 0; i--)
  {
    var pos = pairs[i].indexOf('=');
    if (pos == -1)
      continue;
    var argname = pairs[i].substring(0, pos);
    var argvalue = pairs[i].substring(pos + 1);
    if (argvalue.startsWith("'") && argvalue.endsWith("'"))
      args[argname] = argvalue.substring(1, argvalue.length - 1);
    else
      try {
        args[argname] = decodeURIComponent(argvalue);
      } catch (e) {args[argname] = argvalue;}
    // dump("[" + argname + "=" + args[argname] + "]\n");
  }
  return args;
}

function ComposeFieldsReady()
{
  // Limit the charsets to those we think are safe to encode (i.e., they are in
  // the charset menu). Easiest way to normalize this is to use the TextDecoder
  // to get the canonical alias and default if it isn't valid.
  let charset;
  try {
    charset = new TextDecoder(gMsgCompose.compFields.characterSet).encoding;
  } catch (e) {
    charset = gMsgCompose.compFields.defaultCharacterSet;
  }
  SetDocumentCharacterSet(charset);

  //If we are in plain text, we need to set the wrap column
  if (! gMsgCompose.composeHTML) {
    try {
      gMsgCompose.editor.QueryInterface(nsIPlaintextEditorMail).wrapWidth
          = gMsgCompose.wrapLength;
    }
    catch (e) {
      dump("### textEditor.wrapWidth exception text: " + e + " - failed\n");
    }
  }
  CompFields2Recipients(gMsgCompose.compFields);
  SetComposeWindowTitle();
  updateEditableFields(false);
}

// checks if the passed in string is a mailto url, if it is, generates nsIMsgComposeParams
// for the url and returns them.
function handleMailtoArgs(mailtoUrl)
{
  // see if the string is a mailto url....do this by checking the first 7 characters of the string
  if (mailtoUrl.toLowerCase().startsWith("mailto:"))
  {
    // if it is a mailto url, turn the mailto url into a MsgComposeParams object....
    let uri = Services.io.newURI(mailtoUrl);

    if (uri) {
      return MailServices.compose.getParamsForMailto(uri);
    }
  }

  return null;
}

/**
 * Handle ESC keypress from composition window for
 * notifications with close button in the
 * attachmentNotificationBox.
 */
function handleEsc()
{
  let activeElement = document.activeElement;

  // If findbar is visible and the focus is in the message body,
  // hide it. (Focus on the findbar is handled by findbar itself).
  let findbar = document.getElementById('FindToolbar');
  if (!findbar.hidden && activeElement.id == "content-frame") {
    findbar.close();
    return;
  }

  // If there is a notification in the attachmentNotificationBox
  // AND focus is in message body, subject field or on the notification,
  // hide it.
  let notification = document.getElementById("attachmentNotificationBox")
                             .currentNotification;
  if (notification && (activeElement.id == "content-frame" ||
      activeElement.parentNode.parentNode.id == "msgSubject" ||
      notification.contains(activeElement) ||
      activeElement.classList.contains("messageCloseButton"))) {
    notification.close();
  }
}

function disableAttachmentReminder()
{
  gDisableAttachmentReminder = true;
  toggleAttachmentReminder(false);
}

/**
 * This state machine manages all showing and hiding of the attachment
 * notification bar. It is only called if any change happened so that
 * recalculating of the notification is needed:
 * - keywords changed
 * - manual reminder was toggled
 * - attachments changed
 * - manual reminder is disabled
 *
 * It does not track whether the notification is still up when it should be.
 * That allows the user to close it any time without this function showing
 * it again.
 * We ensure notification is only shown on right events, e.g. only when we have
 * keywords and attachments were removed (but not when we have keywords and
 * manual reminder was just turned off). We always show the notification
 * again if keywords change (if no attachments and no manual reminder).
 *
 * @param aForce  If set to true, notification will be shown immediately if
 *                there are any keywords. If set to false, it is shown only when
 *                they have changed.
 */
function manageAttachmentNotification(aForce = false)
{
  let keywords;
  let keywordsCount = 0;

  // First see if the notification is to be hidden due to reasons other than
  // not having keywords.
  let removeNotification = attachmentNotificationSupressed();

  // If that is not true, we need to look at the state of keywords.
  if (!removeNotification) {
    if (attachmentWorker.lastMessage) {
      // We know the state of keywords, so process them.
      if (attachmentWorker.lastMessage.length) {
        keywords = attachmentWorker.lastMessage.join(", ");
        keywordsCount = attachmentWorker.lastMessage.length;
      }
      removeNotification = keywordsCount == 0;
    } else {
      // We don't know keywords, so get them first.
      // If aForce was true, and some keywords are found, we get to run again from
      // attachmentWorker.onmessage().
      gAttachmentNotifier.redetectKeywords(aForce);
      return;
    }
  }

  let nBox = document.getElementById("attachmentNotificationBox");
  let notification = nBox.getNotificationWithValue("attachmentReminder");
  if (removeNotification) {
    if (notification)
      nBox.removeNotification(notification);

    return;
  }

  // We have some keywords, however only pop up the notification if requested
  // to do so.
  if (!aForce)
    return;

  let textValue = getComposeBundle().getString("attachmentReminderKeywordsMsgs");
  textValue = PluralForm.get(keywordsCount, textValue)
                        .replace("#1", keywordsCount);
  // If the notification already exists, we simply add the new attachment
  // specific keywords to the existing notification instead of creating it
  // from scratch.
  if (notification) {
    let description = notification.querySelector("#attachmentReminderText");
    description.setAttribute("value", textValue);
    description = notification.querySelector("#attachmentKeywords");
    description.setAttribute("value", keywords);
    return;
  }

  // Construct the notification as we don't have one.
  let msg = document.createElement("hbox");
  msg.setAttribute("flex", "100");
  msg.onclick = function(event) {
    openOptionsDialog("paneCompose", "generalTab",
                      {subdialog: "attachment_reminder_button"});
  };

  let msgText = document.createElement("label");
  msg.appendChild(msgText);
  msgText.id = "attachmentReminderText";
  msgText.setAttribute("crop", "end");
  msgText.setAttribute("flex", "1");
  msgText.setAttribute("value", textValue);
  let msgKeywords = document.createElement("label");
  msg.appendChild(msgKeywords);
  msgKeywords.id = "attachmentKeywords";
  msgKeywords.setAttribute("crop", "end");
  msgKeywords.setAttribute("flex", "1000");
  msgKeywords.setAttribute("value", keywords);
  let addButton = {
    accessKey : getComposeBundle().getString("addAttachmentButton.accesskey"),
    label: getComposeBundle().getString("addAttachmentButton"),
    callback: function (aNotificationBar, aButton) {
      goDoCommand("cmd_attachFile");
      return true; // keep notification open (the state machine will decide on it later)
    }
  };

  let remindLaterMenuPopup = document.createElement("menupopup");
  remindLaterMenuPopup.id = "reminderBarPopup";
  let disableAttachmentReminder = document.createElement("menuitem");
  disableAttachmentReminder.id = "disableReminder";
  disableAttachmentReminder.setAttribute("label",
    getComposeBundle().getString("disableAttachmentReminderButton"));
  disableAttachmentReminder.setAttribute("command", "cmd_doNotRemindForAttachments");
  remindLaterMenuPopup.appendChild(disableAttachmentReminder);

  let remindButton = {
    type: "menu-button",
    accessKey : getComposeBundle().getString("remindLaterButton.accesskey"),
    label: getComposeBundle().getString("remindLaterButton"),
    popup: remindLaterMenuPopup,
    callback: function (aNotificationBar, aButton) {
      toggleAttachmentReminder(true);
    }
  };

  notification = nBox.appendNotification("", "attachmentReminder",
                               /* fake out the image so we can do it in CSS */
                               "null",
                               nBox.PRIORITY_WARNING_MEDIUM,
                               [addButton, remindButton]);
  let buttons = notification.childNodes[0];
  notification.insertBefore(msg, buttons);
}

/**
 * Returns whether the attachment notification should be suppressed regardless of
 * the state of keywords.
 */
function attachmentNotificationSupressed() {
  return (gDisableAttachmentReminder || gManualAttachmentReminder ||
          AttachmentElementHasItems());
}

var attachmentWorker = new Worker("resource:///modules/attachmentChecker.js");

// The array of currently found keywords. Or null if keyword detection wasn't
// run yet so we don't know.
attachmentWorker.lastMessage = null;

attachmentWorker.onerror = function(error)
{
  Cu.reportError("Attachment Notification Worker error!!! " + error.message);
  throw error;
};

/**
 * Called when attachmentWorker finishes checking of the message for keywords.
 *
 * @param event    If defined, event.data contains an array of found keywords.
 * @param aManage  If set to true and we determine keywords have changed,
 *                 manage the notification.
 *                 If set to false, just store the new keyword list but do not
 *                 touch the notification. That effectively eats the
 *                 "keywords changed" event which usually shows the notification
 *                 if it was hidden. See manageAttachmentNotification().
 */
attachmentWorker.onmessage = function(event, aManage = true)
{
  // Exit if keywords haven't changed.
  if (!event || (attachmentWorker.lastMessage &&
                (event.data.toString() == attachmentWorker.lastMessage.toString())))
    return;

  let data = event ? event.data : [];
  attachmentWorker.lastMessage = data.slice(0);
  if (aManage)
    manageAttachmentNotification(true);
};

/**
 * Update attachment-related internal flags, UI, and commands.
 * Called when number of attachments changes.
 *
 * @param aShowPane {string} "show":  show the attachment pane
 *                           "hide":  hide the attachment pane
 *                           omitted: just update without changing pane visibility
 * @param aContentChanged {Boolean} optional value to assign to gContentChanged;
 *                                  defaults to true.
 */
function AttachmentsChanged(aShowPane, aContentChanged = true) {
  gContentChanged = aContentChanged;
  updateAttachmentPane(aShowPane);
  attachmentBucketMarkEmptyBucket();
  manageAttachmentNotification(true);
  updateAttachmentItems();
}

/**
 * This functions returns a valid spellcheck language. It checks that a
 * dictionary exists for the language passed in, if any. It also retrieves the
 * corresponding preference and ensures that a dictionary exists. If not, it
 * adjusts the preference accordingly.
 * When the nominated dictionary does not exist, the effects are very confusing
 * to the user: Inline spell checking does not work, although the option is
 * selected and a spell check dictionary seems to be selected in the options
 * dialog (the dropdown shows the first list member if the value is not in
 * the list). It is not at all obvious that the preference value is wrong.
 * This case can happen two scenarios:
 * 1) The dictionary that was selected in the preference is removed.
 * 2) The selected dictionary changes the way it announces itself to the system,
 *    so for example "it_IT" changes to "it-IT" and the previously stored
 *    preference value doesn't apply any more.
 */
function getValidSpellcheckerDictionary(draftLanguage) {
  let prefValue = Services.prefs.getCharPref("spellchecker.dictionary");
  let spellChecker = Cc["@mozilla.org/spellchecker/engine;1"]
                       .getService(mozISpellCheckingEngine);
  let o1 = {};
  let o2 = {};
  spellChecker.getDictionaryList(o1, o2);
  let dictList = o1.value;
  let count    = o2.value;

  if (count == 0) {
    // If there are no dictionaries, we can't check the value, so return it.
    return prefValue;
  }

  // Make sure that the draft language contains a valid value.
  if (draftLanguage && dictList.includes(draftLanguage)) {
    return draftLanguage;
  }

  // Make sure preference contains a valid value.
  if (dictList.includes(prefValue)) {
    return prefValue;
  }

  // Set a valid value, any value will do.
  Services.prefs.setCharPref("spellchecker.dictionary", dictList[0]);
  return dictList[0];
}

var dictionaryRemovalObserver =
{
  observe: function(aSubject, aTopic, aData) {
    if (aTopic != "spellcheck-dictionary-remove") {
      return;
    }
    let language = document.documentElement.getAttribute("lang");
    let spellChecker = Cc["@mozilla.org/spellchecker/engine;1"]
                         .getService(mozISpellCheckingEngine);
    let o1 = {};
    let o2 = {};
    spellChecker.getDictionaryList(o1, o2);
    let dictList = o1.value;
    let count    = o2.value;

    if (count > 0 && dictList.includes(language)) {
      // There still is a dictionary for the language of the document.
      return;
    }

    // Set a valid language from the preference.
    let prefValue = Services.prefs.getCharPref("spellchecker.dictionary");
    if (count == 0 || dictList.includes(prefValue)) {
      language = prefValue;
    } else {
      language = dictList[0];
      // Fix the preference while we're here. We know it's invalid.
      Services.prefs.setCharPref("spellchecker.dictionary", language);
    }
    document.documentElement.setAttribute("lang", language);
  },

  isAdded: false,

  addObserver: function() {
    Services.obs.addObserver(this, "spellcheck-dictionary-remove");
    this.isAdded = true;
  },

  removeObserver: function() {
    if (this.isAdded) {
      Services.obs.removeObserver(this, "spellcheck-dictionary-remove");
      this.isAdded = false;
    }
  }
}

/**
 * On paste or drop, we may want to modify the content before inserting it into
 * the editor, replacing file URLs with data URLs when appropriate.
 */
function onPasteOrDrop(e) {
  // For paste use e.clipboardData, for drop use e.dataTransfer.
  let dataTransfer = ("clipboardData" in e) ? e.clipboardData : e.dataTransfer;

  if (!dataTransfer.types.includes("text/html")) {
    return;
  }

  if (!gMsgCompose.composeHTML) {
    // We're in the plain text editor. Nothing to do here.
    return;
  }

  let html = dataTransfer.getData("text/html");
  let doc = (new DOMParser()).parseFromString(html, "text/html");
  let tmpD = Services.dirsvc.get("TmpD", Ci.nsIFile);
  let pendingConversions = 0;
  let needToPreventDefault = true;
  for (let img of doc.images) {
    if (!/^file:/i.test(img.src)) {
      // Doesn't start with file:. Nothing to do here.
      continue;
    }

    // This may throw if the URL is invalid for the OS.
    let nsFile;
    try {
      nsFile = Services.io.getProtocolHandler("file")
        .QueryInterface(Ci.nsIFileProtocolHandler)
        .getFileFromURLSpec(img.src);
    } catch (ex) {
      continue;
    }

    if (!nsFile.exists()) {
      continue;
    }

    if (!tmpD.contains(nsFile)) {
       // Not anywhere under the temp dir.
      continue;
    }

    let contentType = Cc["@mozilla.org/mime;1"]
      .getService(Ci.nsIMIMEService)
      .getTypeFromFile(nsFile);
    if (!contentType.startsWith("image/")) {
      continue;
    }

    // If we ever get here, we need to prevent the default paste or drop since
    // the code below will do its own insertion.
    if (needToPreventDefault) {
      e.preventDefault();
      needToPreventDefault = false;
    }

    File.createFromNsIFile(nsFile).then(function(file) {
      if (file.lastModified < (Date.now() - 60000)) {
        // Not put in temp in the last minute. May be something other than
        // a copy-paste. Let's not allow that.
        return;
      }

      let doTheInsert = function() {
        // Now run it through sanitation to make sure there wasn't any
        // unwanted things in the content.
        let ParserUtils = Cc["@mozilla.org/parserutils;1"]
          .getService(Ci.nsIParserUtils);
        let html2 = ParserUtils.sanitize(doc.documentElement.innerHTML,
                                       ParserUtils.SanitizerAllowStyle);
        getBrowser().contentDocument.execCommand("insertHTML", false, html2);
      }

      // Everything checks out. Convert file to data URL.
      let reader = new FileReader();
      reader.addEventListener("load", function() {
        let dataURL = reader.result;
        pendingConversions--;
        img.src = dataURL;
        if (pendingConversions == 0) {
          doTheInsert();
        }
      });
      reader.addEventListener("error", function() {
        pendingConversions--;
        if (pendingConversions == 0) {
          doTheInsert();
        }
      });

      pendingConversions++;
      reader.readAsDataURL(file);
    });
  }
}

function ComposeStartup(aParams)
{
  // Findbar overlay
  if (!document.getElementById("findbar-replaceButton")) {
    let replaceButton = document.createElement("toolbarbutton");
    replaceButton.setAttribute("id", "findbar-replaceButton");
    replaceButton.setAttribute("class", "findbar-button tabbable");
    replaceButton.setAttribute("label", getComposeBundle().getString("replaceButton.label"));
    replaceButton.setAttribute("accesskey", getComposeBundle().getString("replaceButton.accesskey"));
    replaceButton.setAttribute("tooltiptext", getComposeBundle().getString("replaceButton.tooltip"));
    replaceButton.setAttribute("oncommand", "findbarFindReplace();");

    let findbar = document.getElementById("FindToolbar");
    let lastButton = findbar.getElement("find-entire-word");
    let tSeparator = document.createElement("toolbarseparator");
    tSeparator.setAttribute("id", "findbar-beforeReplaceSeparator");
    lastButton.parentNode.insertBefore(replaceButton, lastButton.nextSibling);
    lastButton.parentNode.insertBefore(tSeparator, lastButton.nextSibling);
  }

  var params = null; // New way to pass parameters to the compose window as a nsIMsgComposeParameters object
  var args = null;   // old way, parameters are passed as a string
  gBodyFromArgs = false;

  if (aParams)
    params = aParams;
  else if (window.arguments && window.arguments[0]) {
    try {
      if (window.arguments[0] instanceof Ci.nsIMsgComposeParams)
        params = window.arguments[0];
      else
        params = handleMailtoArgs(window.arguments[0]);
    }
    catch(ex) { dump("ERROR with parameters: " + ex + "\n"); }

    // if still no dice, try and see if the params is an old fashioned list of string attributes
    // XXX can we get rid of this yet?
    if (!params)
    {
      args = GetArgs(window.arguments[0]);
    }
  }

  // Set a sane starting width/height for all resolutions on new profiles.
  // Do this before the window loads.
  if (!document.documentElement.hasAttribute("width"))
  {
    // Prefer 860x800.
    let defaultHeight = Math.min(screen.availHeight, 800);
    let defaultWidth = Math.min(screen.availWidth, 860);

    // On small screens, default to maximized state.
    if (defaultHeight <= 600)
      document.documentElement.setAttribute("sizemode", "maximized");

    document.documentElement.setAttribute("width", defaultWidth);
    document.documentElement.setAttribute("height", defaultHeight);
    // Make sure we're safe at the left/top edge of screen
    document.documentElement.setAttribute("screenX", screen.availLeft);
    document.documentElement.setAttribute("screenY", screen.availTop);
  }

  // Observe the language attribute so we can update the language button label.
  gLanguageObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type == "attributes" && mutation.attributeName == "lang") {
        updateLanguageInStatusBar();

        // Update the language in the composition fields, so we can save it
        // to the draft next time.
        if (gMsgCompose && gMsgCompose.compFields) {
          gMsgCompose.compFields.contentLanguage =
            document.documentElement.getAttribute("lang");
        }
      }
    });
  });
  gLanguageObserver.observe(document.documentElement, { attributes: true });

  // Observe dictionary removals.
  dictionaryRemovalObserver.addObserver();

  var identityList = document.getElementById("msgIdentity");

  document.addEventListener("keypress", awDocumentKeyPress, true);

  document.addEventListener("paste", onPasteOrDrop);
  document.addEventListener("drop", onPasteOrDrop);

  if (identityList)
    FillIdentityList(identityList);

  if (!params) {
    // This code will go away soon as now arguments are passed to the window using a object of type nsMsgComposeParams instead of a string

    params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
    params.composeFields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);

    if (args) { //Convert old fashion arguments into params
      var composeFields = params.composeFields;
      if (args.bodyislink == "true")
        params.bodyIsLink = true;
      if (args.type)
        params.type = args.type;
      if (args.format)
      {
        // Only use valid values.
        if (args.format == Ci.nsIMsgCompFormat.PlainText ||
            args.format == Ci.nsIMsgCompFormat.HTML ||
            args.format == Ci.nsIMsgCompFormat.OppositeOfDefault)
          params.format = args.format;
        else if (args.format.toLowerCase().trim() == "html")
          params.format = Ci.nsIMsgCompFormat.HTML;
        else if (args.format.toLowerCase().trim() == "text")
          params.format = Ci.nsIMsgCompFormat.PlainText;
      }
      if (args.originalMsgURI)
        params.originalMsgURI = args.originalMsgURI;
      if (args.preselectid)
        params.identity = getIdentityForKey(args.preselectid);
      if (args.from)
        composeFields.from = args.from;
      if (args.to)
        composeFields.to = args.to;
      if (args.cc)
        composeFields.cc = args.cc;
      if (args.bcc)
        composeFields.bcc = args.bcc;
      if (args.newsgroups)
        composeFields.newsgroups = args.newsgroups;
      if (args.subject)
        composeFields.subject = args.subject;
      if (args.attachment)
      {
        let attachmentList = args.attachment.split(",");
        let commandLine = Cc["@mozilla.org/toolkit/command-line;1"]
                            .createInstance();
        for (let attachmentName of attachmentList)
        {
          // resolveURI does all the magic around working out what the
          // attachment is, including web pages, and generating the correct uri.
          let uri = commandLine.resolveURI(attachmentName);
          let attachment = Cc["@mozilla.org/messengercompose/attachment;1"]
                             .createInstance(Ci.nsIMsgAttachment);
          // If uri is for a file and it exists set the attachment size.
          if (uri instanceof Ci.nsIFileURL)
          {
            if (uri.file.exists())
              attachment.size = uri.file.fileSize;
            else
              attachment = null;
          }

          // Only want to attach if a file that exists or it is not a file.
          if (attachment)
          {
            attachment.url = uri.spec;
            composeFields.addAttachment(attachment);
          }
          else
          {
            let title = getComposeBundle().getString("errorFileAttachTitle");
            let msg = getComposeBundle().getFormattedString("errorFileAttachMessage",
                                                        [attachmentName]);
            Services.prompt.alert(null, title, msg);
          }
        }
      }
      if (args.newshost)
        composeFields.newshost = args.newshost;
      if (args.message) {
        let msgFile = Cc["@mozilla.org/file/local;1"]
                        .createInstance(Ci.nsIFile);
        if (OS.Path.dirname(args.message) == ".") {
          let workingDir = Services.dirsvc.get("CurWorkD", Ci.nsIFile);
          args.message = OS.Path.join(workingDir.path, OS.Path.basename(args.message));
        }
        msgFile.initWithPath(args.message);

        if (!msgFile.exists()) {
          let title = getComposeBundle().getString("errorFileMessageTitle");
          let msg = getComposeBundle().getFormattedString("errorFileMessageMessage",
                                                          [args.message]);
          Services.prompt.alert(null, title, msg);
        }
        else {
          let data = "";
          let fstream = null;
          let cstream = null;

          try {
            fstream = Cc["@mozilla.org/network/file-input-stream;1"]
                        .createInstance(Ci.nsIFileInputStream);
            cstream = Cc["@mozilla.org/intl/converter-input-stream;1"]
                        .createInstance(Ci.nsIConverterInputStream);
            fstream.init(msgFile, -1, 0, 0); // Open file in default/read-only mode.
            cstream.init(fstream, "UTF-8", 0, 0);

            let str = {};
            let read = 0;

            do {
              // Read as much as we can and put it in str.value.
              read = cstream.readString(0xffffffff, str);
              data += str.value;
            } while (read != 0);
          } catch (e) {
            let title = getComposeBundle().getString("errorFileMessageTitle");
            let msg = getComposeBundle().getFormattedString("errorLoadFileMessageMessage",
                                                            [args.message]);
            Services.prompt.alert(null, title, msg);

          } finally {
            if (cstream)
              cstream.close();
            if (fstream)
              fstream.close();
          }

          if (data) {
            let pos = data.search(/\S/); // Find first non-whitespace character.

            if (params.format != Ci.nsIMsgCompFormat.PlainText &&
                (args.message.endsWith(".htm") || args.message.endsWith(".html") ||
                 data.substr(pos, 14).toLowerCase() == "<!doctype html" ||
                 data.substr(pos, 5).toLowerCase() == "<html")) {
              // We replace line breaks because otherwise they'll be converted to
              // <br> in nsMsgCompose::BuildBodyMessageAndSignature().
              // Don't do the conversion if the user asked explicitly for plain text.
              data = data.replace(/\r?\n/g," ");
            }
            gBodyFromArgs = true;
            composeFields.body = data;
          }
        }
      }
      else if (args.body) {
        gBodyFromArgs = true;
        composeFields.body = args.body;
      }
    }
  }
  
  // Ticket mantis 0005306: Emetteur d'un message dans le courrielleur basé sur Thunderbird 60
  if (params) {
    
    let origMsgHdr=params.origMsgHdr;
    
    if (origMsgHdr && origMsgHdr.folder){

      let ident=GetDefaultIdentityForMsgHdr(origMsgHdr);

      if (ident)
        params.identity=ident;
    }
  }
  // fin Ticket mantis 0005306

  gComposeType = params.type;

  // Deuxième CORRECTION ticket 5306
  // Detect correct identity when missing or mismatched.
  // An identity with no email is likely not valid.
  // When editing a draft, 'params.identity' is pre-populated with the identity
  // that created the draft or the identity owning the draft folder for a "foreign",
  // draft, see ComposeMessage() in mailCommands.js. We don't want the latter,
  // so use the creator identity which could be null.
  
  // //5963 
  /*if (gComposeType == nsIMsgCompType.Draft) {
    let creatorKey = params.composeFields.creatorIdentityKey;
    params.identity = creatorKey ? getIdentityForKey(creatorKey) : null;
  }*/
  let from = [];
  if (params.composeFields.from)
    from = MailServices.headerParser.parseEncodedHeader(params.composeFields.from, null);
  from = (from.length && from[0] && from[0].email) ?
    from[0].email.toLowerCase().trim() : null;
  if (!params.identity || !params.identity.email ||
      (from && !emailSimilar(from, params.identity.email))) {
    let identities = MailServices.accounts.allIdentities;
    let suitableCount = 0;

    // Search for a matching identity. //5963 
    /*if (from) {
      for (let ident of fixIterator(identities, Ci.nsIMsgIdentity)) {
        if (ident.email && from == ident.email.toLowerCase()) {
          if (suitableCount == 0)
          {
            params.identity = ident;
            console.log(params.identity.email);
          }
          suitableCount++;
          if (suitableCount > 1)
            break; // No need to find more, it's already not unique.
        }
      }
    }*/

    if (!params.identity || !params.identity.email) {
      // No preset identity and no match, so use the default account.
      let identity = MailServices.accounts.defaultAccount.defaultIdentity;
      if (!identity) {
        let identities = MailServices.accounts.allIdentities;
        if (identities.length > 0)
          identity = identities.queryElementAt(0, Ci.nsIMsgIdentity);
      }
      params.identity = identity;
    }

    // Warn if no or more than one match was found.
    // But don't warn for +suffix additions (a+b@c.com). //5963 
    /*if (from && (suitableCount > 1 || (suitableCount == 0 && !emailSimilar(from, params.identity.email))))
      gComposeNotificationBar.setIdentityWarning(params.identity.identityName);*/
  }
  
  // #5306 on ajoute le if pour éviter de vérifier l'identity si elle est null
  if(params.identity)
    identityList.selectedItem = identityList.getElementsByAttribute("identitykey", params.identity.key)[0];
    
  /* remplace par ticket 5306
  // mantis 2749 Emetteur par défaut d'un message émis depuis le dossier modèle
  // mantis 0004983: Expéditeur non modifié lors du déplacement d'1 message dans une autre boîte
  let origMsgHdr=params.origMsgHdr;
  if (origMsgHdr &&
      origMsgHdr.folder &&
      cm2IsFolderDraftTemplate(origMsgHdr.folder)){
    let ident=GetDefaultIdentityForMsgHdr(origMsgHdr);
    if (ident)
      identityList.selectedItem=identityList.getElementsByAttribute("identitykey", ident.key)[0];
  }
  //fin mantis 2749  (+ else)      
  */
  /* remplace par ticket 5306
  // Here we set the From from the original message, be it a draft or another
  // message, for example a template, we want to "edit as new".
  // Only do this if the message is our own draft or template.
  else if (params.composeFields.creatorIdentityKey && params.composeFields.from)
  {
    let from = MailServices.headerParser.parseEncodedHeader(params.composeFields.from, null).join(", ");
    if (from != identityList.value)
    {
      MakeFromFieldEditable(true);
      identityList.value = from;
    }
  }
  */
  LoadIdentity(true);

  // Get the <editor> element to startup an editor
  var editorElement = GetCurrentEditorElement();

  // Remember the original message URI. When editing a draft which is a reply
  // or forwarded message, this gets overwritten by the ancestor's message URI so
  // the disposition flags ("replied" or "forwarded") can be set on the ancestor.
  // For our purposes we need the URI of the message being processed, not its
  // original ancestor.
  gOriginalMsgURI = params.originalMsgURI;
  gMsgCompose = MailServices.compose.initCompose(params, window, editorElement.docShell);

  gMsgCompose.addMsgSendListener(gSendListener);

  document.getElementById("returnReceiptMenu")
          .setAttribute('checked', gMsgCompose.compFields.returnReceipt);
  document.getElementById("dsnMenu")
          .setAttribute("checked", gMsgCompose.compFields.DSN);
  document.getElementById("cmd_attachVCard")
          .setAttribute("checked", gMsgCompose.compFields.attachVCard);
  toggleAttachmentReminder(gMsgCompose.compFields.attachmentReminder);
  gSendFormat = gMsgCompose.compFields.deliveryFormat;
  SetCompositionAsPerDeliveryFormat(gSendFormat);
  SelectDeliveryFormatMenuOption(gSendFormat);

  // Set document language to the draft language or the preference
  // if this is a draft or template we prepared.
  let draftLanguage = null;
  if (gMsgCompose.compFields.creatorIdentityKey &&
      gMsgCompose.compFields.contentLanguage) {
    draftLanguage = gMsgCompose.compFields.contentLanguage;
  }

  let languageToSet = getValidSpellcheckerDictionary(draftLanguage);
  document.documentElement.setAttribute("lang", languageToSet);

  let editortype = gMsgCompose.composeHTML ? "htmlmail" : "textmail";
  editorElement.makeEditable(editortype, true);

  // setEditorType MUST be called before setContentWindow
  if (gMsgCompose.composeHTML)
  {
    initLocalFontFaceMenu(document.getElementById("FontFacePopup"));
  }
  else
  {
    // We are editing in plain text mode.
    // The SetCompositionAsPerDeliveryFormat call above already hid
    // the HTML toolbar, format and insert menus.
    // Also remove the delivery format from the options menu.
    document.getElementById("outputFormatMenu").setAttribute("hidden", true);
  }

  // Do setup common to Message Composer and Web Composer.
  EditorSharedStartup();

  if (params.bodyIsLink)
  {
    let body = gMsgCompose.compFields.body;
    if (gMsgCompose.composeHTML)
    {
      let cleanBody;
      try {
        cleanBody = decodeURI(body);
      } catch(e) { cleanBody = body; }

      body = body.replace(/&/g, "&amp;");
      gMsgCompose.compFields.body =
        "<br /><a href=\"" + body + "\">" + cleanBody + "</a><br />";
    }
    else
    {
      gMsgCompose.compFields.body = "\n<" + body + ">\n";
    }
  }

  GetMsgSubjectElement().value = gMsgCompose.compFields.subject;

  AddAttachments(gMsgCompose.compFields.attachments, null, false);

  if (Services.prefs.getBoolPref(
      "mail.compose.show_attachment_pane")) {
    toggleAttachmentPane("show");
  }

  document.getElementById("msgcomposeWindow").dispatchEvent(
    new Event("compose-window-init", { bubbles: false , cancelable: true }));

  gMsgCompose.RegisterStateListener(stateListener);

  // Add an observer to be called when document is done loading,
  // which creates the editor.
  try {
    GetCurrentCommandManager().
            addCommandObserver(gMsgEditorCreationObserver, "obs_documentCreated");

    // Load empty page to create the editor.
    editorElement.webNavigation.loadURI("about:blank", 0, null, null, null);
  } catch (e) {
    Cu.reportError(e);
  }

  gEditingDraft = gMsgCompose.compFields.draftId;

  // finally, see if we need to auto open the address sidebar.
  var sideBarBox = document.getElementById('sidebar-box');
  if (sideBarBox.getAttribute("sidebarVisible") == "true")
  {
    // if we aren't supposed to have the side bar hidden, make sure it is visible
    if (document.getElementById("sidebar").getAttribute("src") == "")
      setTimeout(toggleAddressPicker, 0);   // do this on a delay so we don't hurt perf. on bringing up a new compose window
  }

  // Update the priority button.
  if (gMsgCompose.compFields.priority)
    updatePriorityToolbarButton(gMsgCompose.compFields.priority);

  gAutoSaveInterval = getPref("mail.compose.autosave") ?
    getPref("mail.compose.autosaveinterval") * 60000 : 0;

  if (gAutoSaveInterval)
    gAutoSaveTimeout = setTimeout(AutoSave, gAutoSaveInterval);

  gAutoSaveKickedIn = false;
}

function splitEmailAddress(aEmail) {
  let at = aEmail.lastIndexOf("@");
  return (at != -1) ? [aEmail.slice(0, at), aEmail.slice(at + 1)] : [aEmail, ""];
}

// Emails are equal ignoring +suffixes (email+suffix@example.com).
function emailSimilar(a, b) {
  if (!a || !b)
    return a == b;
  a = splitEmailAddress(a.toLowerCase());
  b = splitEmailAddress(b.toLowerCase());
  return a[1] == b[1] && a[0].split("+", 1)[0] == b[0].split("+", 1)[0];
}

// The new, nice, simple way of getting notified when a new editor has been created
var gMsgEditorCreationObserver =
{
  observe: function(aSubject, aTopic, aData)
  {
    if (aTopic == "obs_documentCreated")
    {
      var editor = GetCurrentEditor();
      if (editor && GetCurrentCommandManager() == aSubject)
      {
        var editorStyle = editor.QueryInterface(Ci.nsIEditorStyleSheets);
        // We use addOverrideStyleSheet rather than addStyleSheet so that we get
        // a synchronous load, rather than having a late-finishing async load
        // mark our editor as modified when the user hasn't typed anything yet,
        // but that means the sheet must not @import slow things, especially
        // not over the network.
        editorStyle.addOverrideStyleSheet("chrome://messenger/skin/messageQuotes.css");
        InitEditor();
      }
      // Now that we know this document is an editor, update commands now if
      // the document has focus, or next time it receives focus via
      // CommandUpdate_MsgCompose()
      if (gLastWindowToHaveFocus == document.commandDispatcher.focusedWindow)
        updateComposeItems();
      else
        gLastWindowToHaveFocus = null;
    }
  }
}

function WizCallback(state)
{
  if (state){
    ComposeStartup(null);
  }
  else
  {
    // The account wizard is still closing so we can't close just yet
    setTimeout(MsgComposeCloseWindow, 0);
  }
}

function ComposeLoad()
{
  try {
    var other_headers = getPref("mail.compose.other.header");
  }
  catch (ex) {
    dump("failed to get the mail.compose.other.header pref\n");
  }

  AddMessageComposeOfflineQuitObserver();

  setupAutocomplete();

  try {
    SetupCommandUpdateHandlers();
    // This will do migration, or create a new account if we need to.
    // We also want to open the account wizard if no identities are found
    //var state = verifyAccounts(WizCallback, true);
    var state = verifyAccounts(WizCallback, true, cm2ExecPacome);

    if (other_headers) {
      var selectNode = document.getElementById('addressCol1#1');
      var other_headers_Array = other_headers.split(",");
      for (let i = 0; i < other_headers_Array.length; i++)
        selectNode.appendItem(other_headers_Array[i] + ":", "addr_other");
    }
    if (state)
      ComposeStartup(null);
  }
  catch (ex) {
    Cu.reportError(ex);
    Services.prompt.alert(window, getComposeBundle().getString("initErrorDlogTitle"),
                          getComposeBundle().getString("initErrorDlgMessage"));

    MsgComposeCloseWindow();
    return;
  }

  CompactTheme.init();
  ToolbarIconColor.init();

  // initialize the customizeDone method on the customizeable toolbar
  var toolbox = document.getElementById("compose-toolbox");
  toolbox.customizeDone = function(aEvent) { MailToolboxCustomizeDone(aEvent, "CustomizeComposeToolbar"); };

  var toolbarset = document.getElementById('customToolbars');
  toolbox.toolbarset = toolbarset;

  awInitializeNumberOfRowsShown();
  updateAttachmentPane();
  attachmentBucketMarkEmptyBucket();
}

function ComposeUnload()
{
  // Send notification that the window is going away completely.
  document.getElementById("msgcomposeWindow").dispatchEvent(
    new Event("compose-window-unload", { bubbles: false, cancelable: false }));

  GetCurrentCommandManager().removeCommandObserver(gMsgEditorCreationObserver,
                                                   "obs_documentCreated");
  UnloadCommandUpdateHandlers();

  // In some Mozmill tests, the window is closed so quickly that the observer
  // hasn't fired and removed itself yet, so let's remove it here.
  spellCheckReadyObserver.removeObserver();
  // Stop gSpellChecker so personal dictionary is saved.
  enableInlineSpellCheck(false);

  EditorCleanup();

  if (gMsgCompose)
    gMsgCompose.removeMsgSendListener(gSendListener);

  RemoveMessageComposeOfflineQuitObserver();
  gAttachmentNotifier.shutdown();
  ToolbarIconColor.uninit();
  CompactTheme.uninit();

  // Stop observing dictionary removals.
  dictionaryRemovalObserver.removeObserver();

  if (gMsgCompose)
    gMsgCompose.UnregisterStateListener(stateListener);
  if (gAutoSaveTimeout)
    clearTimeout(gAutoSaveTimeout);
  if (msgWindow)
    msgWindow.closeWindow();

  ReleaseGlobalVariables();
}

function SetDocumentCharacterSet(aCharset)
{
  if (gMsgCompose) {
    gMsgCompose.SetDocumentCharset(aCharset);
    updateEncodingInStatusBar();
  }
  else
    dump("Compose has not been created!\n");
}

/**
 * Return the full display string for any non-default text encoding of the
 * current composition (friendly name plus official character set name).
 * For the default text encoding, return empty string (""), to reduce
 * ux-complexity, e.g. for the default Status Bar display.
 * Note: The default is retrieved from mailnews.send_default_charset.
 *
 * @return string representation of non-default charset, otherwise "".
 */
function GetCharsetUIString()
{
  // The charset here is already the canonical charset (not an alias).
  let charset = gMsgCompose.compFields.characterSet;
  if (!charset)
    return "";

  if (charset.toLowerCase() != gMsgCompose.compFields.defaultCharacterSet.toLowerCase()) {
    try {
      return gCharsetConvertManager.getCharsetTitle(charset);
    }
    catch(e) { // Not a canonical charset after all...
      Cu.reportError("No charset title for charset=" + charset);
      return charset;
    }
  }
  return "";
}

// Add-ons can override this to customize the behavior.
function DoSpellCheckBeforeSend()
{
  return getPref("mail.SpellCheckBeforeSend");
}

/**
 * Handles message sending operations.
 * @param msgType nsIMsgCompDeliverMode of the operation.
 */
function GenericSendMessage(msgType)
{  
  // mantis 5129
  if (nsIMsgCompDeliverMode.AutoSaveAsDraft==msgType &&
      !Services.io.offline){

    function rappel(){

      if (nsIMsgCompDeliverMode.AutoSaveAsDraft!=msgType){
        window.setCursor("auto");
      }
      
      if (Services.io.offline) {
        Services.prompt.alert(window, "",
                              getComposeBundle().getString("cm2EnvoiOffline"));
      }
      
      GenericSendMessageTB(msgType);
      
      return;
    }

    // si le dossier de l'emetteur est du type imap => test de connexion
    // dans le cas brouillon ou modele
    let ident=getCurrentIdentity();
    if (ident){
      
      let dossier=ident.draftFolder;
      
      if (dossier.length &&
          0==dossier.indexOf("imap:")){

        // disable the ui if we're not auto-saving
        if (nsIMsgCompDeliverMode.AutoSaveAsDraft!=msgType){
          window.setCursor("wait");
          ToggleWindowLock(true);
        }
        
        cm2TestImapM2(rappel);

        return;     
      }
    }
  } 

  GenericSendMessageTB(msgType);
}

function GenericSendMessageTB(msgType)
{
  // #6165: Mise en oeuvre de la Remise différée dans le Courrielleur
  SetMessageCustomHeaders();
  
  var msgCompFields = gMsgCompose.compFields;

  Recipients2CompFields(msgCompFields);
  let addresses = MailServices.headerParser
                              .makeFromDisplayAddress(GetMsgIdentityElement().value);
  msgCompFields.from = MailServices.headerParser.makeMimeHeader(addresses, addresses.length);
  var subject = GetMsgSubjectElement().value;
  msgCompFields.subject = subject;
  Attachments2CompFields(msgCompFields);
  // Some other msgCompFields have already been updated instantly in their respective
  // toggle functions, e.g. ToggleReturnReceipt(), ToggleDSN(),  ToggleAttachVCard(),
  // and toggleAttachmentReminder().

  let sending = msgType == nsIMsgCompDeliverMode.Now ||
      msgType == nsIMsgCompDeliverMode.Later ||
      msgType == nsIMsgCompDeliverMode.Background;
  if (sending)
  {
    expandRecipients();
    // Check if e-mail addresses are complete, in case user turned off
    // autocomplete to local domain.
    if (!CheckValidEmailAddress(msgCompFields))
      return;

    // Do we need to check the spelling?
    if (DoSpellCheckBeforeSend())
    {
      // We disable spellcheck for the following -subject line, attachment
      // pane, identity and addressing widget therefore we need to explicitly
      // focus on the mail body when we have to do a spellcheck.
      SetMsgBodyFrameFocus();
      window.cancelSendMessage = false;
      window.openDialog("chrome://editor/content/EdSpellCheck.xul", "_blank",
                        "dialog,close,titlebar,modal,resizable", true, true, false);

      if (window.cancelSendMessage)
        return;
    }

    // Strip trailing spaces and long consecutive WSP sequences from the
    // subject line to prevent getting only WSP chars on a folded line.
    let fixedSubject = subject.replace(/\s{74,}/g, "    ").trimRight();
    if (fixedSubject != subject)
    {
      subject = fixedSubject;
      msgCompFields.subject = fixedSubject;
      GetMsgSubjectElement().value = fixedSubject;
    }

    // Remind the person if there isn't a subject
    if (subject == "")
    {
      if (Services.prompt.confirmEx(
            window,
            getComposeBundle().getString("subjectEmptyTitle"),
            getComposeBundle().getString("subjectEmptyMessage"),
            (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
            (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1),
            getComposeBundle().getString("sendWithEmptySubjectButton"),
            getComposeBundle().getString("cancelSendingButton"),
            null, null, {value:0}) == 1)
      {
        GetMsgSubjectElement().focus();
        return;
      }
    }

    // Attachment Reminder: Alert the user if
    //  - the user requested "Remind me later" from either the notification bar or the menu
    //    (alert regardless of the number of files already attached: we can't guess for how many
    //    or which files users want the reminder, and guessing wrong will annoy them a lot), OR
    //  - the aggressive pref is set and the latest notification is still showing (implying
    //    that the message has no attachment(s) yet, message still contains some attachment
    //    keywords, and notification was not dismissed).
    if (gManualAttachmentReminder || (getPref("mail.compose.attachment_reminder_aggressive") &&
         document.getElementById("attachmentNotificationBox")
                 .getNotificationWithValue("attachmentReminder"))) {
      let flags = Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
                  Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
      let hadForgotten = Services.prompt.confirmEx(window,
                            getComposeBundle().getString("attachmentReminderTitle"),
                            getComposeBundle().getString("attachmentReminderMsg"),
                            flags,
                            getComposeBundle().getString("attachmentReminderFalseAlarm"),
                            getComposeBundle().getString("attachmentReminderYesIForgot"),
                            null, null, {value:0});
      // Deactivate manual attachment reminder after showing the alert to avoid alert loop.
      // We also deactivate reminder when user ignores alert with [x] or [ESC].
      if (gManualAttachmentReminder)
        toggleAttachmentReminder(false);

      if (hadForgotten)
        return;
    }

    // Check if the user tries to send a message to a newsgroup through a mail
    // account.
    var currentAccountKey = getCurrentAccountKey();
    let account = MailServices.accounts.getAccount(currentAccountKey);
    if (!account)
    {
      throw new Error("currentAccountKey '" + currentAccountKey +
                      "' has no matching account!");
    }
    if (account.incomingServer.type != "nntp" && msgCompFields.newsgroups != "")
    {
      const kDontAskAgainPref = "mail.compose.dontWarnMail2Newsgroup";
      // default to ask user if the pref is not set
      let dontAskAgain = getPref(kDontAskAgainPref);
      if (!dontAskAgain)
      {
        let checkbox = {value:false};
        let okToProceed = Services.prompt.confirmCheck(
                              window,
                              getComposeBundle().getString("noNewsgroupSupportTitle"),
                              getComposeBundle().getString("recipientDlogMessage"),
                              getComposeBundle().getString("CheckMsg"),
                              checkbox);
        if (!okToProceed)
          return;

        if (checkbox.value) {
          Services.prefs.setBoolPref(kDontAskAgainPref, true);
        }
      }

      // remove newsgroups to prevent news_p to be set
      // in nsMsgComposeAndSend::DeliverMessage()
      msgCompFields.newsgroups = "";
    }

    // Before sending the message, check what to do with HTML message,
    // eventually abort.
    var convert = DetermineConvertibility();
    var action = DetermineHTMLAction(convert);

    if (action == nsIMsgCompSendFormat.AskUser)
    {
      var recommAction = (convert == nsIMsgCompConvertible.No)
                          ? nsIMsgCompSendFormat.AskUser
                          : nsIMsgCompSendFormat.PlainText;
      var result2 = {action:recommAction, convertible:convert, abort:false};
      window.openDialog("chrome://messenger/content/messengercompose/askSendFormat.xul",
                        "askSendFormatDialog", "chrome,modal,titlebar,centerscreen",
                        result2);
      if (result2.abort)
        return;
      action = result2.action;
    }

    // We will remember the users "send format" decision in the address
    // collector code (see nsAbAddressCollector::CollectAddress())
    // by using msgCompFields.forcePlainText and msgCompFields.useMultipartAlternative
    // to determine the nsIAbPreferMailFormat (unknown, plaintext, or html).
    // If the user sends both, we remember html.
    switch (action)
    {
      case nsIMsgCompSendFormat.PlainText:
        msgCompFields.forcePlainText = true;
        msgCompFields.useMultipartAlternative = false;
        break;
      case nsIMsgCompSendFormat.HTML:
        msgCompFields.forcePlainText = false;
        msgCompFields.useMultipartAlternative = false;
        break;
      case nsIMsgCompSendFormat.Both:
        msgCompFields.forcePlainText = false;
        msgCompFields.useMultipartAlternative = true;
        break;
      default:
        throw new Error("Invalid nsIMsgCompSendFormat action; action=" + action);
    }
  }

  // hook for extra compose pre-processing
  Services.obs.notifyObservers(window, "mail:composeOnSend");

  var originalCharset = gMsgCompose.compFields.characterSet;
  // Check if the headers of composing mail can be converted to a mail charset.
  if (msgType == nsIMsgCompDeliverMode.Now ||
    msgType == nsIMsgCompDeliverMode.Later ||
    msgType == nsIMsgCompDeliverMode.Background ||
    msgType == nsIMsgCompDeliverMode.Save ||
    msgType == nsIMsgCompDeliverMode.SaveAsDraft ||
    msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft ||
    msgType == nsIMsgCompDeliverMode.SaveAsTemplate)
  {
    var fallbackCharset = new Object;
    // Check encoding, switch to UTF-8 if the default encoding doesn't fit
    // and disable_fallback_to_utf8 isn't set for this encoding.
    if (!gMsgCompose.checkCharsetConversion(getCurrentIdentity(), fallbackCharset))
    {
      var disableFallback = false;
      try
      {
        disableFallback = getPref("mailnews.disable_fallback_to_utf8." + originalCharset);
      }
      catch (e) {}
      if (disableFallback)
        msgCompFields.needToCheckCharset = false;
      else
        fallbackCharset.value = "UTF-8";
    }

    if (fallbackCharset &&
        fallbackCharset.value && fallbackCharset.value != "")
      gMsgCompose.SetDocumentCharset(fallbackCharset.value);
  }

  try {
    // Just before we try to send the message, fire off the
    // compose-send-message event for listeners such as smime so they can do
    // any pre-security work such as fetching certificates before sending.
    var event = document.createEvent("UIEvents");
    event.initEvent("compose-send-message", false, true);
    var msgcomposeWindow = document.getElementById("msgcomposeWindow");
    msgcomposeWindow.setAttribute("msgtype", msgType);
    msgcomposeWindow.dispatchEvent(event);
    if (event.defaultPrevented)
      throw Cr.NS_ERROR_ABORT;

    gAutoSaving = (msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft);

    // disable the ui if we're not auto-saving
    if (!gAutoSaving)
      ToggleWindowLock(true);

    // If we're auto saving, mark the body as not changed here, and not
    // when the save is done, because the user might change it between now
    // and when the save is done.
    else
    {
      SetContentAndBodyAsUnmodified();
    }

    var progress = Cc["@mozilla.org/messenger/progress;1"]
                     .createInstance(Ci.nsIMsgProgress);
    if (progress)
    {
      progress.registerListener(progressListener);
      if (msgType == nsIMsgCompDeliverMode.Save ||
          msgType == nsIMsgCompDeliverMode.SaveAsDraft ||
          msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft ||
          msgType == nsIMsgCompDeliverMode.SaveAsTemplate)
        gSaveOperationInProgress = true;
      else
        gSendOperationInProgress = true;
    }
    msgWindow.domWindow = window;
    msgWindow.rootDocShell.allowAuth = true;
    //bug mantis 2984 (envoi melanissimo) - fontion de capture des envois
    /*gMsgCompose.SendMsg(msgType, getCurrentIdentity(),
                        getCurrentAccountKey(), msgWindow, progress);*/
    M2ssimoSendMsg(gMsgCompose, msgType, getCurrentIdentity(), 
                    getCurrentAccountKey(), msgWindow, progress);
  }
  catch (ex) {
    Cu.reportError("GenericSendMessage FAILED: " + ex);
    ToggleWindowLock(false);
  }
  if (gMsgCompose && originalCharset != gMsgCompose.compFields.characterSet)
    SetDocumentCharacterSet(gMsgCompose.compFields.characterSet);
}

/**
 * Check if the given address is valid (contains a @).
 *
 * @param aAddress  The address string to check.
 */
function isValidAddress(aAddress) {
  return (aAddress.includes("@", 1) && !aAddress.endsWith("@"));
}

/* fonction de capture d'envoi du message pour le module melanissimmo
  remplace la ligne gMsgCompose.SendMsg(msgType,..
  dans la fonction GenericSendMessage
  les parametres de la fonction sont les memes que l'appel gMsgCompose.SendMsg + gMsgCompose=> msgcompose
*/
function M2ssimoSendMsg(msgcompose, msgtype, identite, compte, msgwindow, progress) {

  //verifier que le module cm2m2ssimo est operationnel
  let m2ssimo=false;

  try{
    m2ssimo=Services.prefs.getBoolPref("melanissimo.module");
  } catch(ex){
    m2ssimo=false;
  }

  if (!m2ssimo) {
    //comportement par defaut
    msgcompose.SendMsg(msgtype, identite, compte, msgwindow, progress);
    return;
  }

  //envoi par Thunderbird possible?
  let envoi=m2sCanSendByTB(msgcompose, msgtype, identite, compte);
  m2sTrace("M2ssimoSendMsg m2sCanSendByTB:"+(envoi?"oui":"non"));
  if (envoi){
    //comportement par defaut
    m2sTrace("M2ssimoSendMsg envoi par Thunderbird (standard)");
    m2sEcritLog(M2S_LOGS_MODULE, "Envoi standard par Thunderbird");
    msgcompose.SendMsg(msgtype, identite, compte, msgwindow, progress);

  } else {
    // #6487: Enregistrement d'une PJ dans les brouillons taille supérieure à 10Mo
    if(msgtype == nsIMsgCompDeliverMode.SaveAsDraft || msgtype == nsIMsgCompDeliverMode.AutoSaveAsDraft || msgtype == nsIMsgCompDeliverMode.SaveAsTemplate || msgtype == nsIMsgCompDeliverMode.SaveAsFile)
    {
      gSaveOperationInProgress = false;
      gSendOperationInProgress = false;
      alert("La taille des pièces jointes dépasse la limite autorisée pour sauvegarder ce message dans vos brouillons.");
    }
    //#6466: Avertir d'un envoi avec remise différée qui devrait partir par Mélanissimo
    if(sendDifDate != null && !isNaN(sendDifDate))
    {
      if(confirm("La taille de votre message lui impose d'être pris en charge par un mécanisme qui ne permet pas la remise différée. Voulez-vous continuer avec un envoi immédiat ?"))
      {
        //envoi melanissimo si possible
        m2sTrace("M2ssimoSendMsg traitement par module d'envoi melanissimo");
        m2sEcritLog(M2S_LOGS_MODULE, "Traitement par module d'envoi melanissimo");
        m2sEnvoiMelanissimo(msgcompose, msgtype, identite, compte, msgwindow, progress);
      }
    }
    else
    {
      //envoi melanissimo si possible
      m2sTrace("M2ssimoSendMsg traitement par module d'envoi melanissimo");
      m2sEcritLog(M2S_LOGS_MODULE, "Traitement par module d'envoi melanissimo");
      m2sEnvoiMelanissimo(msgcompose, msgtype, identite, compte, msgwindow, progress);
    }
  }
}

/**
 * Keep the Send buttons disabled until any recipient is entered.
 */
function updateSendLock()
{
  gSendLocked = true;
  if (!gMsgCompose)
    return;

  const mailTypes = [ "addr_to", "addr_cc", "addr_bcc" ];

  // Enable the send buttons if anything usable was entered into at least one
  // recipient field.
  for (let row = 1; row <= top.MAX_RECIPIENTS; row ++)
  {
    let popupValue = awGetPopupElement(row).value;
    let inputValue = awGetInputElement(row).value.trim();
    let listNames = null;
    if ((mailTypes.includes(popupValue) &&
         // a properly looking email address
        (isValidAddress(inputValue) ||
         // a valid mailing list name in some or our addressbooks
         ((listNames = MimeParser.parseHeaderField(inputValue, MimeParser.HEADER_ADDRESS)) &&
          listNames.length > 0 && MailServices.ab.mailListNameExists(listNames[0].name))
        )) || ((popupValue == "addr_newsgroups") && (inputValue != "")))
    {
      gSendLocked = false;
      break;
    }
  }
}

/**
 * Check if the entered addresses are valid and alert the user if they are not.
 *
 * @param aMsgCompFields  A nsIMsgCompFields object containing the fields to check.
 */
function CheckValidEmailAddress(aMsgCompFields)
{
  let invalidStr;
  let recipientCount = 0;
  // Check that each of the To, CC, and BCC recipients contains a '@'.
  for (let type of ["to", "cc", "bcc"]) {
    let recipients = aMsgCompFields.splitRecipients(aMsgCompFields[type], false, {});
    // MsgCompFields contains only non-empty recipients.
    recipientCount += recipients.length;
    for (let recipient of recipients) {
      if (!isValidAddress(recipient)) {
        invalidStr = recipient;
        break;
      }
    }
    if (invalidStr)
      break;
  }

  if (recipientCount == 0 && aMsgCompFields.newsgroups.trim() == "") {
    Services.prompt.alert(window, getComposeBundle().getString("addressInvalidTitle"),
                          getComposeBundle().getString("noRecipients"));
    return false;
  }

  if (invalidStr)
  {
    Services.prompt.alert(window, getComposeBundle().getString("addressInvalidTitle"),
                          getComposeBundle().getFormattedString("addressInvalid",
                          [invalidStr], 1));
    return false;
  }

  return true;
}


// Returns the same Date.now than original Cpp header code nsMsgCompUtils.cpp
Date.prototype.toMailString = function() {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    let timezoneOffset = this.getTimezoneOffset();
    const offsetSigne = timezoneOffset < 0 ? '+' : '-';
    const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
    const offsetMinutes = Math.abs(timezoneOffset) % 60;

    const offset = offsetSigne + ("0" + offsetHours).slice(-2) + ("0" + offsetMinutes).slice(-2);

    return days[this.getDay()] + ", " 
        + this.getDate() + " " 
        + months[this.getMonth()] + " " 
        + this.getFullYear() + " " 
        + ("0" + this.getHours()).slice(-2) + ":" 
        + ("0" + this.getMinutes()).slice(-2) + ":" 
        + ("0" + this.getSeconds()).slice(-2) + " " 
        + offset;
};

function SetMessageCustomHeaders()
{  
  // #6700: Champ date non renseigné depuis une BALP et envoi différé ne focntionne pas - Ajout tolérance d'erreurs
  // #6246: Envoi différé ne fonctionne pas depuis une BALP: séparation en methode et ajout boucle id
  // #6165: Mise en oeuvre de la Remise différée dans le Courrielleur pour chaque identity
  let i = 0;
  let error = 0;
  let allHeadersSet = false;
  while(allHeadersSet != true)
  {
    try
    {
      i++;
      if(Services.prefs.getCharPref("mail.identity.id"+i.toString()+".useremail"))
      {
        // Si on a une date d'envoi différé, on active le header correspondant et le header date
        if(sendDifDate != null && !isNaN(sendDifDate))
        {
          // Conversion de la date différée en format utilisé normalement par C++
          Services.prefs.setCharPref("mail.identity.id"+i.toString()+".header.custom_date", "Date: " + sendDifDate.toMailString());
          
          // Stockage timestamp pour envoi différé
          //Services.prefs.setCharPref("mail.identity.timestamp_envoi_differe", Math.floor(sendDifDate/1000));
          Services.prefs.setCharPref("mail.identity.id"+i.toString()+".header.date_envoi_differe", "X-DateEnvoiDiffere: " + Math.floor(sendDifDate/1000));
          Services.prefs.setCharPref("mail.identity.id"+i.toString()+".headers", "date_envoi_differe,custom_date");
        }
        else
        {
          // Sinon on ajoute juste le header Date (il a été supprimé du C++ dans nsMsgCompUtils.cpp)
          // Conversion de la date actuelle en format utilisé normalement par C++
          let dateNow = new Date(Date.now());
          Services.prefs.setCharPref("mail.identity.id"+i.toString()+".header.custom_date", "Date: " + dateNow.toMailString());//ConvertToCppDate(dateNow));
          Services.prefs.setCharPref("mail.identity.id"+i.toString()+".headers","custom_date");
        }
      }
      else
      {
        error++;
      }
    }
    catch
    {
      error++;
      // On tolère 10 erreurs d'attribution d'header
      if(error >= 10)
      {
        allHeadersSet = true;
      }
    }
  }
}

function SendMessage()
{  
  let sendInBackground = Services.prefs.getBoolPref("mailnews.sendInBackground");
  if (sendInBackground && (AppConstants.platform != "macosx")) {
    let enumerator = Services.wm.getEnumerator(null);
    let count = 0;
    while (enumerator.hasMoreElements() && count < 2) {
      let win = enumerator.getNext();
      count++;
    }
    if (count == 1)
      sendInBackground = false;
  }

  GenericSendMessage(sendInBackground ?
                     nsIMsgCompDeliverMode.Background :
                     nsIMsgCompDeliverMode.Now);
  ExitFullscreenMode();
}

function SendMessageWithCheck()
{
    var warn = getPref("mail.warn_on_send_accel_key");

    if (warn) {
        let checkValue = {value:false};
        let buttonPressed = Services.prompt.confirmEx(window,
              getComposeBundle().getString('sendMessageCheckWindowTitle'),
              getComposeBundle().getString('sendMessageCheckLabel'),
              (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
              (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
              getComposeBundle().getString('sendMessageCheckSendButtonLabel'),
              null, null,
              getComposeBundle().getString('CheckMsg'),
              checkValue);
        if (buttonPressed != 0) {
            return;
        }
        if (checkValue.value) {
            Services.prefs.setBoolPref("mail.warn_on_send_accel_key", false);
        }
    }

  let sendInBackground = Services.prefs.getBoolPref("mailnews.sendInBackground");

  GenericSendMessage(Services.io.offline ? nsIMsgCompDeliverMode.Later :
                     (sendInBackground ?
                      nsIMsgCompDeliverMode.Background :
                      nsIMsgCompDeliverMode.Now));

  ExitFullscreenMode();
}

function SendMessageLater()
{
  GenericSendMessage(nsIMsgCompDeliverMode.Later);
  ExitFullscreenMode();
}

function ExitFullscreenMode()
{
  // On OS X we need to deliberately exit full screen mode after sending.
  if (AppConstants.platform == "macosx") {
    window.fullScreen = false;
  }
}

function Save()
{
  switch (defaultSaveOperation)
  {
    case "file"     : SaveAsFile(false);      break;
    case "template" : SaveAsTemplate(false);  break;
    default         : SaveAsDraft(false);     break;
  }
}

function SaveAsFile(saveAs)
{
  var subject = GetMsgSubjectElement().value;
  GetCurrentEditorElement().contentDocument.title = subject;

  if (gMsgCompose.bodyConvertible() == nsIMsgCompConvertible.Plain)
    SaveDocument(saveAs, false, "text/plain");
  else
    SaveDocument(saveAs, false, "text/html");
  defaultSaveOperation = "file";
}

function SaveAsDraft()
{
  gAutoSaveKickedIn = false;
  gEditingDraft = true;

  GenericSendMessage(nsIMsgCompDeliverMode.SaveAsDraft);
  defaultSaveOperation = "draft";
}

function SaveAsTemplate()
{
  gAutoSaveKickedIn = false;
  gEditingDraft = false;

  let savedReferences = null;
  if (gMsgCompose && gMsgCompose.compFields) {
    // Clear References header. When we use the template, we don't want that
    // header, yet, "edit as new message" maintains it. So we need to clear
    // it when saving the template.
    // Note: The In-Reply-To header is the last entry in the references header,
    // so it will get cleared as well.
    savedReferences = gMsgCompose.compFields.references;
    gMsgCompose.compFields.references = null;
  }

  GenericSendMessage(nsIMsgCompDeliverMode.SaveAsTemplate);
  defaultSaveOperation = "template";

  if (savedReferences)
    gMsgCompose.compFields.references = savedReferences;
}

// Sets the additional FCC, in addition to the default FCC.
function MessageFcc(aFolder)
{
  if (!gMsgCompose)
    return;

  var msgCompFields = gMsgCompose.compFields;
  if (!msgCompFields)
    return;

  // Get the uri for the folder to FCC into.
  var fccURI = aFolder.URI;
  msgCompFields.fcc2 = (msgCompFields.fcc2 == fccURI) ? "nocopy://" : fccURI;
}

function updatePriorityMenu()
{
  if (gMsgCompose)
  {
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields && msgCompFields.priority)
    {
      var priorityMenu = document.getElementById('priorityMenu' );
      priorityMenu.querySelector('[checked="true"]').removeAttribute('checked');
      priorityMenu.querySelector('[value="' + msgCompFields.priority + '"]').setAttribute('checked', 'true');
    }
  }
}

function updatePriorityToolbarButton(newPriorityValue)
{
  var prioritymenu = document.getElementById('priorityMenu-button');
  if (prioritymenu)
    prioritymenu.value = newPriorityValue;
}

function PriorityMenuSelect(target)
{
  if (gMsgCompose)
  {
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
      msgCompFields.priority = target.getAttribute('value');

    // keep priority toolbar button in synch with possible changes via the menu item
    updatePriorityToolbarButton(target.getAttribute('value'));
  }
}

/**
 * Shows HTML formatting menus/toolbars if they are useful for the selected
 * message delivery format. E.g. they are not needed for plain text format.
 *
 * @param aDeliveryFormat  The chosen output format from the nsIMsgCompSendFormat enum.
 */
function SetCompositionAsPerDeliveryFormat(aDeliveryFormat)
{
  let format_toolbar = document.getElementById("FormatToolbar");
  let format_menu = document.getElementById("formatMenu");
  let insert_menu = document.getElementById("insertMenu");
  let view_menuitem = document.getElementById("menu_showFormatToolbar");

  let hideMenus = !gMsgCompose.composeHTML;
  format_menu.hidden = hideMenus;
  insert_menu.hidden = hideMenus;
  view_menuitem.hidden = hideMenus;
  // Hide the HTML toolbar for a plain text composition
  // or the user manually hid the toolbar on the view menu.
  format_toolbar.hidden = hideMenus ||
    (view_menuitem.getAttribute("checked") == "false");
}

function SelectDeliveryFormatMenuOption(aDeliveryFormat)
{
  let deliveryFormat;

  switch(aDeliveryFormat) {
    case nsIMsgCompSendFormat.PlainText:
      deliveryFormat = "format_plain";
      break;
    case nsIMsgCompSendFormat.HTML:
      deliveryFormat = "format_html";
      break;
    case nsIMsgCompSendFormat.Both:
      deliveryFormat = "format_both";
      break;
    case nsIMsgCompSendFormat.AskUser:
    default:
      deliveryFormat = "format_auto";
  }

  document.getElementById(deliveryFormat).setAttribute("checked", "true");
}

function OutputFormatMenuSelect(target)
{
  let currentSendFormat = gSendFormat;

  if (gMsgCompose) {
    let msgCompFields = gMsgCompose.compFields;
    if (msgCompFields) {
      switch (target.getAttribute("id")) {
        case "format_plain":
          gSendFormat = nsIMsgCompSendFormat.PlainText;
          break;
        case "format_html":
          gSendFormat = nsIMsgCompSendFormat.HTML;
          break;
        case "format_both":
          gSendFormat = nsIMsgCompSendFormat.Both;
          break;
        case "format_auto":
        default:
          gSendFormat = nsIMsgCompSendFormat.AskUser;
      }
    }

    SetCompositionAsPerDeliveryFormat(gSendFormat);
    gMsgCompose.compFields.deliveryFormat = gSendFormat;
    gContentChanged = currentSendFormat != gSendFormat;
  }
}

// walk through the recipients list and add them to the inline spell checker ignore list
function addRecipientsToIgnoreList(aAddressesToAdd)
{
  if (gSpellChecker.enabled)
  {
    // break the list of potentially many recipients back into individual names
    var emailAddresses = {};
    var names = {};
    var fullNames = {};
    let numAddresses = MailServices.headerParser.parseHeadersWithArray(aAddressesToAdd, emailAddresses, names, fullNames);
    if (!names)
      return;
    let tokenizedNames = [];

    // Each name could consist of multiple word delimited by either commas or spaces, i.e. Green Lantern
    // or Lantern,Green. Tokenize on comma first, then tokenize again on spaces.
    for (let name in names.value)
    {
      if (!names.value[name])
        continue;
      let splitNames = names.value[name].split(',');
      for (let i = 0; i < splitNames.length; i++)
      {
        // now tokenize off of white space
        let splitNamesFromWhiteSpaceArray = splitNames[i].split(' ');
        for (let whiteSpaceIndex = 0; whiteSpaceIndex < splitNamesFromWhiteSpaceArray.length; whiteSpaceIndex++)
          if (splitNamesFromWhiteSpaceArray[whiteSpaceIndex])
            tokenizedNames.push(splitNamesFromWhiteSpaceArray[whiteSpaceIndex]);
      }
    }
    spellCheckReadyObserver.addWordsToIgnore(tokenizedNames);
  }
}

/**
 * Observer waiting for spell checker to become initialized or to complete
 * checking. When it fires, it pushes new words to be ignored to the speller.
 */
var spellCheckReadyObserver =
{
  _topic: "inlineSpellChecker-spellCheck-ended",

  _ignoreWords: [],

  observe: function(aSubject, aTopic, aData) {
    if (aTopic != this._topic) {
      return;
    }

    this.removeObserver();
    this._addWords();
  },

  _isAdded: false,

  addObserver: function() {
    if (this._isAdded)
      return;

    Services.obs.addObserver(this, this._topic);
    this._isAdded = true;
  },

  removeObserver: function() {
    if (!this._isAdded)
      return;

    Services.obs.removeObserver(this, this._topic);
    this._clearPendingWords();
    this._isAdded = false;
  },

  addWordsToIgnore: function (aIgnoreWords) {
    this._ignoreWords.push(...aIgnoreWords);
    if (gSpellChecker.mInlineSpellChecker.spellCheckPending) {
      // spellchecker is enabled, but we must wait for its init to complete
      this.addObserver();
    } else {
      this._addWords();
    }
  },

  _addWords: function() {
    // At the time the speller finally got initialized, we may already be closing
    // the compose together with the speller, so we need to check if they
    // are still valid.
    if (gMsgCompose && gSpellChecker.enabled) {
      gSpellChecker.mInlineSpellChecker.ignoreWords(this._ignoreWords, this._ignoreWords.length);
    }
    this._clearPendingWords();
  },

  _clearPendingWords() {
    this._ignoreWords.length = 0;
  }
}

function onAddressColCommand(aAddressWidgetId)
{
  gContentChanged = true;
  awSetAutoComplete(aAddressWidgetId.slice(aAddressWidgetId.lastIndexOf('#') + 1));
  updateSendCommands(true);
}

/**
 * Called if the list of recipients changed in any way.
 *
 * @param aAutomatic  Set to true if the change of recipients was invoked
 *                    programmatically and should not be considered a change
 *                    of message content.
 */
function onRecipientsChanged(aAutomatic)
{
  if (!aAutomatic) {
    gContentChanged = true;
  }
  updateSendCommands(true);
}

/**
 * Show the popup identified by aPopupID
 * at the anchor element identified by aAnchorID.
 *
 * Note: All but the first 2 parameters are identical with the parameters of
 * the openPopup() method of XUL popup element. For details, please consult docs.
 * Except aPopupID, all parameters are optional.
 * Example: showPopupById("aPopupID", "aAnchorID");
 *
 * @param aPopupID   the ID of the popup element to be shown
 * @param aAnchorID  the ID of an element to which the popup should be anchored
 * @param aPosition  a single-word alignment value for the position parameter
 *                   of openPopup() method; defaults to "after_start" if omitted.
 * @param x          x offset from default position
 * @param y          y offset from default position
 * @param isContextMenu {boolean} For details, see documentation.
 * @param attributesOverride {boolean} whether the position attribute on the
 *                                     popup node overrides the position parameter
 * @param triggerEvent the event that triggered the popup
 */
function showPopupById(aPopupID, aAnchorID, aPosition = "after_start",
                       x, y, isContextMenu, attributesOverride, triggerEvent) {
  let popup = document.getElementById(aPopupID);
  let anchor = document.getElementById(aAnchorID);
  popup.openPopup(anchor, aPosition, x, y,
                  isContextMenu, attributesOverride, triggerEvent);
}

function InitLanguageMenu()
{
  var languageMenuList = document.getElementById('languageMenuList');
  if (!languageMenuList)
    return;

  var spellChecker = Cc['@mozilla.org/spellchecker/engine;1']
                       .getService(mozISpellCheckingEngine);
  var o1 = {};
  var o2 = {};

  // Get the list of dictionaries from
  // the spellchecker.

  spellChecker.getDictionaryList(o1, o2);

  var dictList = o1.value;
  var count    = o2.value;

  // If dictionary count hasn't changed then no need to update the menu.
  if (sDictCount == count)
    return;

  // Store current dictionary count.
  sDictCount = count;

  var sortedList = gSpellChecker.sortDictionaryList(dictList);

  // Remove any languages from the list.
  while (languageMenuList.hasChildNodes())
    languageMenuList.lastChild.remove();

  for (let i = 0; i < count; i++)
  {
    var item = document.createElement("menuitem");
    item.setAttribute("label", sortedList[i].label);
    item.setAttribute("value", sortedList[i].id);
    item.setAttribute('type', 'radio');
    languageMenuList.appendChild(item);
  }
}

function OnShowDictionaryMenu(aTarget)
{
  InitLanguageMenu();
  let curLang = document.documentElement.getAttribute("lang");
  if (!curLang)
    return;

  let language = aTarget.querySelector('[value="' + curLang + '"]');
  if (language)
    language.setAttribute("checked", true);
}

/**
 * Change the language of the composition and if we are using inline
 * spell check, recheck the message with the new dictionary.
 *
 * Note: called from the "Check Spelling" panel in SelectLanguage().
 * @param aLang  New language to set.
 */
function ComposeChangeLanguage(aLang)
{
  if (document.documentElement.getAttribute("lang") != aLang) {
    // Update the document language as well (needed to synchronise
    // the subject).
    document.documentElement.setAttribute("lang", aLang);

    let spellChecker = gSpellChecker.mInlineSpellChecker.spellChecker;
    if (spellChecker) {
      spellChecker.SetCurrentDictionary(aLang);

      // now check the document over again with the new dictionary
      if (gSpellChecker.enabled) {
        gSpellChecker.mInlineSpellChecker.spellCheckRange(null);

        // Also force a recheck of the subject. If for some reason the spell
        // checker isn't ready yet, don't auto-create it, hence pass 'false'.
        let inlineSpellChecker =
          GetMsgSubjectElement().editor.getInlineSpellChecker(false);
        if (inlineSpellChecker) {
          inlineSpellChecker.spellCheckRange(null);
        }
      }
    }
  }
}

/**
 * Change the language of the composition and if we are using inline
 * spell check, recheck the message with the new dictionary.
 *
 * @param event  Event of selecting an item in the spelling button menulist popup.
 */
function ChangeLanguage(event)
{
  ComposeChangeLanguage(event.target.value);
  event.stopPropagation();
}

function updateLanguageInStatusBar()
{
  InitLanguageMenu();
  let languageMenuList = document.getElementById("languageMenuList");
  let spellCheckStatusPanel = document.getElementById("spellCheckStatusPanel");
  let languageStatusButton = document.getElementById("languageStatusButton");
  if (!languageMenuList || !spellCheckStatusPanel || !languageStatusButton) {
    return;
  }

  let language = document.documentElement.getAttribute("lang");
  let item = languageMenuList.firstChild;

  // No status display, if there is only one or no spelling dictionary available.
  if (item == languageMenuList.lastChild) {
    spellCheckStatusPanel.collapsed = true;
    languageStatusButton.label = "";
    return;
  }

  spellCheckStatusPanel.collapsed = false;
  while (item) {
    if (item.getAttribute("value") == language) {
      languageStatusButton.label = item.getAttribute("label");
      break;
    }
    item = item.nextSibling;
  }
}

function updateEncodingInStatusBar()
{
  let encodingUIString = GetCharsetUIString();
  let encodingStatusPanel = document.getElementById("encodingStatusPanel");
  if (!encodingStatusPanel) {
    return;
  }

  // Update status display; no status display for default text encoding.
  encodingStatusPanel.collapsed = !(encodingStatusPanel.label = encodingUIString);
}

function ToggleReturnReceipt(target)
{
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
    {
        msgCompFields.returnReceipt = ! msgCompFields.returnReceipt;
        target.setAttribute('checked', msgCompFields.returnReceipt);
        gReceiptOptionChanged = true;
    }
}

function ToggleDSN(target)
{
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
    {
        msgCompFields.DSN = ! msgCompFields.DSN;
        target.setAttribute('checked', msgCompFields.DSN);
        gDSNOptionChanged = true;
    }
}

function ToggleAttachVCard(target)
{
  var msgCompFields = gMsgCompose.compFields;
  if (msgCompFields)
  {
    msgCompFields.attachVCard = ! msgCompFields.attachVCard;
    target.setAttribute('checked', msgCompFields.attachVCard);
    gAttachVCardOptionChanged = true;
  }
}

/**
 * Toggles or sets the status of manual Attachment Reminder, i.e. whether
 * the user will get the "Attachment Reminder" alert before sending or not.
 * Toggles checkmark on "Remind me later" menuitem and internal
 * gManualAttachmentReminder flag accordingly.
 *
 * @param aState (optional) true = activate reminder.
 *                          false = deactivate reminder.
 *                          (default) = toggle reminder state.
 */
function toggleAttachmentReminder(aState = !gManualAttachmentReminder)
{
  gManualAttachmentReminder = aState;
  document.getElementById("cmd_remindLater")
          .setAttribute("checked", aState);
  gMsgCompose.compFields.attachmentReminder = aState;

  // If we enabled manual reminder, the reminder can't be turned off.
  if (aState)
    gDisableAttachmentReminder = false;

  manageAttachmentNotification(false);
}

function FillIdentityList(menulist)
{
  let accounts = allAccountsSorted(true);

  let accountHadSeparator = false;
  let firstAccountWithIdentities = true;
  for (let acc = 0; acc < accounts.length; acc++) {
    let account = accounts[acc];
    let identities = toArray(fixIterator(account.identities,
                                         Ci.nsIMsgIdentity));

    if (identities.length == 0)
      continue;

    let needSeparator = (identities.length > 1);
    if (needSeparator || accountHadSeparator) {
      // Separate identities from this account from the previous
      // account's identities if there is more than 1 in the current
      // or previous account.
      if (!firstAccountWithIdentities) {
        // only if this is not the first account shown
        let separator = document.createElement("menuseparator");
        menulist.menupopup.appendChild(separator);
      }
      accountHadSeparator = needSeparator;
    }
    firstAccountWithIdentities = false;

    for (let i = 0; i < identities.length; i++) {
      let identity = identities[i];
      let uid=identity.identityName;
      try {         
        let pref="mail.identity."+identity.key+".identityName";
        uid=Services.prefs.getCharPref(pref);          
      } catch(ex) {} 
      let item = menulist.appendItem(account.incomingServer.prettyName,
                                     identity.fullAddress,
                                     uid);
      item.setAttribute("identitykey", identity.key);
      item.setAttribute("accountkey", account.key);
      if (i == 0) {
        // Mark the first identity as default.
        item.setAttribute("default", "true");
      }
    }
  }
  /* mantis 0004633: Supprimer la fonctionnalite 'Personnaliser l'adresse d'expedition'
  menulist.menupopup.appendChild(document.createElement("menuseparator"));
  menulist.menupopup.appendChild(document.createElement("menuitem"))
          .setAttribute("command", "cmd_customizeFromAddress");
  */
}

function getCurrentAccountKey()
{
  // Get the account's key.
  let identityList = GetMsgIdentityElement();
  return identityList.selectedItem.getAttribute("accountkey");
}

function getCurrentIdentityKey()
{
  // Get the identity key.
  let identityList = GetMsgIdentityElement();
  return identityList.selectedItem.getAttribute("identitykey");
}

function getIdentityForKey(key)
{
  return MailServices.accounts.getIdentity(key);
}

function getCurrentIdentity()
{
  return getIdentityForKey(getCurrentIdentityKey());
}

function AdjustFocus()
{
  //dump("XXX adjusting focus\n");
  var element = awGetInputElement(awGetNumberOfRecipients());
  if (element.value == "") {
      //dump("XXX focus on address\n");
      awSetFocus(awGetNumberOfRecipients(), element);
  }
  else
  {
      element = GetMsgSubjectElement();
      if (element.value == "") {
        //dump("XXX focus on subject\n");
        element.focus();
      }
      else {
        //dump("XXX focus on body\n");
        SetMsgBodyFrameFocus();
      }
  }
}

/**
 * Set the compose window title with flavors (Write | Print Preview).
 *
 * @param isPrintPreview (optional) true:  Set title for 'Print Preview' window.
 *                                  false: Set title for 'Write' window (default).
 */
function SetComposeWindowTitle(isPrintPreview = false) {
  let aStringName = isPrintPreview ? "windowTitlePrintPreview"
                                   : "windowTitleWrite";
  let subject = GetMsgSubjectElement().value.trim() ||
                getComposeBundle().getString("defaultSubject");
  let brandBundle = document.getElementById("brandBundle");
  let brandShortName = brandBundle.getString("brandShortName");
  let newTitle = getComposeBundle().getFormattedString(aStringName,
                                                       [subject, brandShortName]);
  document.title = newTitle;
}

// Check for changes to document and allow saving before closing
// This is hooked up to the OS's window close widget (e.g., "X" for Windows)
function ComposeCanClose()
{
  // No open compose window?
  if (!gMsgCompose)
    return true;

  // Do this early, so ldap sessions have a better chance to
  // cleanup after themselves.
  if (gSendOperationInProgress || gSaveOperationInProgress)
  {
    let result;

    let brandBundle = document.getElementById("brandBundle");
    let brandShortName = brandBundle.getString("brandShortName");
    let promptTitle = gSendOperationInProgress ?
      getComposeBundle().getString("quitComposeWindowTitle") :
      getComposeBundle().getString("quitComposeWindowSaveTitle");
    let promptMsg = gSendOperationInProgress ?
      getComposeBundle().getFormattedString("quitComposeWindowMessage2",
        [brandShortName], 1) :
      getComposeBundle().getFormattedString("quitComposeWindowSaveMessage",
        [brandShortName], 1);
    let quitButtonLabel = getComposeBundle().getString("quitComposeWindowQuitButtonLabel2");
    let waitButtonLabel = getComposeBundle().getString("quitComposeWindowWaitButtonLabel2");

    result = Services.prompt.confirmEx(window, promptTitle, promptMsg,
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1),
        waitButtonLabel, quitButtonLabel, null, null, {value:0});

    if (result == 1)
    {
      gMsgCompose.abort();
      return true;
    }
    return false;
  }

  // Returns FALSE only if user cancels save action
  if (gContentChanged || gMsgCompose.bodyModified || gAutoSaveKickedIn)
  {
    // call window.focus, since we need to pop up a dialog
    // and therefore need to be visible (to prevent user confusion)
    window.focus();
    let draftFolderURI = gCurrentIdentity.draftFolder;
    let draftFolderName = MailUtils.getFolderForURI(draftFolderURI).prettyName;
    let result = Services.prompt
                         .confirmEx(window,
                                    getComposeBundle().getString("saveDlogTitle"),
                                    getComposeBundle().getFormattedString("saveDlogMessages3", [draftFolderName]),
                                    (Services.prompt.BUTTON_TITLE_SAVE * Services.prompt.BUTTON_POS_0) +
                                    (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                                    (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_2),
                                    null,
                                    null,
                                    getComposeBundle().getString("discardButtonLabel"),
                                    null, {value:0});
    switch (result)
    {
      case 0: //Save
        // Since we're going to save the message, we tell toolkit that
        // the close command failed, by returning false, and then
        // we close the window ourselves after the save is done.
        gCloseWindowAfterSave = true;
        // We catch the exception because we need to tell toolkit that it
        // shouldn't close the window, because we're going to close it
        // ourselves. If we don't tell toolkit that, and then close the window
        // ourselves, the toolkit code that keeps track of the open windows
        // gets off by one and the app can close unexpectedly on os's that
        // shutdown the app when the last window is closed.
        try {
          // mantis 5129
          GenericSendMessageTB(nsIMsgCompDeliverMode.AutoSaveAsDraft);
        }
        catch (ex) {
          Cu.reportError(ex);
        }
        return false;
      case 1: //Cancel
        return false;
      case 2: //Don't Save
        // don't delete the draft if we didn't start off editing a draft
        // and the user hasn't explicitly saved it.
        if (!gEditingDraft && gAutoSaveKickedIn)
          RemoveDraft();
        // Remove auto-saved draft created during "edit template".
        if (gMsgCompose.compFields.templateId && gAutoSaveKickedIn)
          RemoveDraft();
        break;
    }
  }

  return true;
}

function RemoveDraft()
{
  try
  {
    var draftUri = gMsgCompose.compFields.draftId;
    var msgKey = draftUri.substr(draftUri.indexOf('#') + 1);
    var rdf = Cc['@mozilla.org/rdf/rdf-service;1']
                .getService(Ci.nsIRDFService);

    var folder = rdf.GetResource(gMsgCompose.savedFolderURI)
                    .QueryInterface(Ci.nsIMsgFolder);
    try {
      if (folder.flags & Ci.nsMsgFolderFlags.Drafts)
      {
        var msgs = Cc["@mozilla.org/array;1"].
            createInstance(Ci.nsIMutableArray);
        msgs.appendElement(folder.GetMessageHeader(msgKey));
        folder.deleteMessages(msgs, null, true, false, null, false);
      }
    }
    catch (ex) // couldn't find header - perhaps an imap folder.
    {
      var imapFolder = folder.QueryInterface(Ci.nsIMsgImapMailFolder);
      var keyArray = new Array;
      keyArray[0] = msgKey;
      imapFolder.storeImapFlags(8, true, keyArray, 1, null);
    }
  } catch (ex) {}
}

function SetContentAndBodyAsUnmodified()
{
  gMsgCompose.bodyModified = false;
  gContentChanged = false;
}

function MsgComposeCloseWindow()
{
  if (gMsgCompose)
    gMsgCompose.CloseWindow();
  else
    window.close();
}

function GetLastAttachDirectory()
{
  var lastDirectory;

  try {
    lastDirectory = Services.prefs
                            .getComplexValue(kComposeAttachDirPrefName,
                                             Ci.nsIFile);
  }
  catch (ex) {
    // this will fail the first time we attach a file
    // as we won't have a pref value.
    lastDirectory = null;
  }

  return lastDirectory;
}

// attachedLocalFile must be a nsIFile
function SetLastAttachDirectory(attachedLocalFile)
{
  try {
    let file = attachedLocalFile.QueryInterface(Ci.nsIFile);
    let parent = file.parent.QueryInterface(Ci.nsIFile);

    Services.prefs.setComplexValue(kComposeAttachDirPrefName,
                                   Ci.nsIFile, parent);
  }
  catch (ex) {
    dump("error: SetLastAttachDirectory failed: " + ex + "\n");
  }
}

function AttachFile()
{
  if (attachmentsCount() > 0) {
    // If there are existing attachments already, restore attachment pane before
    // showing the file picker so that user can see them while adding more.
    toggleAttachmentPane("show");
  }

  //Get file using nsIFilePicker and convert to URL
  let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
  fp.init(window, getComposeBundle().getString("chooseFileToAttach"),
          nsIFilePicker.modeOpenMultiple);

  let lastDirectory = GetLastAttachDirectory();
  if (lastDirectory)
    fp.displayDirectory = lastDirectory;

  fp.appendFilters(nsIFilePicker.filterAll);
  fp.open(rv => {
    if (rv != Ci.nsIFilePicker.returnOK || !fp.files)
      return;

    let file;
    let attachments = [];

    for (file of fixIterator(fp.files, Ci.nsIFile))
      attachments.push(FileToAttachment(file));

    AddAttachments(attachments);
    SetLastAttachDirectory(file);
  });
}

/**
 * Convert an nsIFile instance into an nsIMsgAttachment.
 *
 * @param file the nsIFile
 * @return an attachment pointing to the file
 */
function FileToAttachment(file)
{
  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Ci.nsIFileProtocolHandler);
  let attachment = Cc["@mozilla.org/messengercompose/attachment;1"]
                     .createInstance(Ci.nsIMsgAttachment);

  attachment.url = fileHandler.getURLSpecFromFile(file);
  attachment.size = file.fileSize;
  return attachment;
}

/**
 * Add a list of attachment objects as attachments. The attachment URLs must be
 * set.
 *
 * @param aAttachments  an iterable list of nsIMsgAttachment objects to add as
 *                      attachments. Anything iterable with fixIterator is
 *                      accepted.
 * @param aCallback     an optional callback function called immediately after
 *                      adding each attachment. Takes one argument:
 *                      the newly-added <attachmentitem> node.
 * @param aContentChanged {Boolean}  optional value to assign to gContentChanged
 *                                   after adding attachments; defaults to true.
 */
function AddAttachments(aAttachments, aCallback, aContentChanged = true)
{
  let bucket = document.getElementById("attachmentBucket");
  let addedAttachments = Cc["@mozilla.org/array;1"]
                           .createInstance(Ci.nsIMutableArray);
  let items = [];

  for (let attachment of fixIterator(aAttachments,
                                     Ci.nsIMsgAttachment)) {
    if (!(attachment && attachment.url) ||
        DuplicateFileAlreadyAttached(attachment.url))
      continue;

    if (!attachment.name)
      attachment.name = gMsgCompose.AttachmentPrettyName(attachment.url, null);

    // For security reasons, don't allow *-message:// uris to leak out.
    // We don't want to reveal the .slt path (for mailbox://), or the username
    // or hostname.
    if (/^mailbox-message:|^imap-message:|^news-message:/i.test(attachment.name))
      attachment.name = getComposeBundle().getString("messageAttachmentSafeName");
    // Don't allow file or mail/news protocol uris to leak out either.
    else if (/^file:|^mailbox:|^imap:|^s?news:/i.test(attachment.name))
      attachment.name = getComposeBundle().getString("partAttachmentSafeName");

    let item = bucket.appendItem(attachment);
    addedAttachments.appendElement(attachment);

    if (attachment.size != -1)
      gAttachmentsSize += attachment.size;

    try {
      item.setAttribute("tooltiptext", decodeURI(attachment.url));
    }
    catch(e) {
      item.setAttribute("tooltiptext", attachment.url);
    }
    item.addEventListener("command", OpenSelectedAttachment);

    if (attachment.sendViaCloud) {
      try {
        let cloudProvider = cloudFileAccounts.getAccount(attachment.cloudProviderKey);
        item.cloudProvider = cloudProvider;
        item.image = cloudProvider.iconClass;
        item.originalUrl = attachment.url;
      } catch (ex) {dump(ex);}
    }
    else {
      // For local file urls, we are better off using the full file url because
      // moz-icon will actually resolve the file url and get the right icon from
      // the file url. All other urls, we should try to extract the file name from
      // them. This fixes issues where an icon wasn't showing up if you dragged a
      // web url that had a query or reference string after the file name and for
      // mailnews urls where the filename is hidden in the url as a &filename=
      // part.
      let url = Services.io.newURI(attachment.url);
      if (url instanceof Ci.nsIURL &&
          url.fileName && !url.schemeIs("file")) {
        item.image = "moz-icon://" + url.fileName;
      } else if (/^mailbox-message:|^imap-message:|^news-message:/i.test(attachment.url)) {
        // We're attaching a message, most likely via drag and drop. Pretend that is comes
        // from a file, so we get the icon that matches .eml files.
        item.image = "moz-icon://message.eml";
      } else {
        item.image = "moz-icon:" + attachment.url;
      }
    }

    items.push(item);

    if (aCallback)
      aCallback(item);
  }

  if (addedAttachments.length > 0) {
    // If no attachment item has had focus yet (currentIndex == -1, or undefined
    // on some platforms according to spec), make sure there's at least one item
    // set as currentItem which will be focused when listbox gets focus, because
    // currently we don't indicate focus on the listbox itself when there are
    // attachments, assuming that one of them has focus.
    if (!(bucket.currentIndex >= 0)) {
      bucket.currentIndex = bucket.getIndexOfItem(items[0]);
    }

    AttachmentsChanged("show", aContentChanged);
    dispatchAttachmentBucketEvent("attachments-added", addedAttachments);
  } else if (attachmentsCount() > 0) {
    // We didn't succeed to add attachments (e.g. duplicate files),
    // but user was trying to; so we must at least react by ensuring the pane
    // is shown, which might be hidden by user with existing attachments.
    toggleAttachmentPane("show");
  }

  return items;
}

/**
 * Get the number of all attachments of the message.
 *
 * @return the number of all attachment items in attachmentBucket;
 *         0 if attachmentBucket not found or no attachments in the list.
 */
function attachmentsCount()
{
  let bucketList = GetMsgAttachmentElement();
  return (bucketList) ? bucketList.itemCount : 0;
}

/**
 * Get the number of selected attachments.
 *
 * @return {number}  the number of selected attachments, or 0 if there are
 *                   no attachments selected, no attachments, or no attachmentBucket
 */
function attachmentsSelectedCount()
{
  let bucketList = GetMsgAttachmentElement();
  return (bucketList) ? bucketList.selectedCount : 0;
}

/**
 * Returns a sorted-by-index, "non-live" array of attachment list items.
 *
 * @param aAscending {boolean}: true (default): sort return array ascending
 *                              false         : sort return array descending
 * @param aSelectedOnly {boolean}: true: return array of selected items only.
 *                                 false (default): return array of all items.
 *
 * @return {array} an array of (all | selected) listItem elements in
 *                 attachmentBucket listbox, "non-live" and sorted by their index
 *                 in the list; [] if there are (no | no selected) attachments.
 */
function attachmentsGetSortedArray(aAscending = true, aSelectedOnly = false) {
  let bucketList;
  let listItems;

  if (aSelectedOnly) {
    // Selected attachments only.
    if (attachmentsSelectedCount() < 1)
      return [];

    bucketList = document.getElementById("attachmentBucket");
    // bucketList.selectedItems is a "live" and "unordered" node list (items get
    // added in the order they were added to the selection). But we want a stable
    // ("non-live") array of selected items, sorted by their index in the list.
    listItems = [...bucketList.selectedItems];
  } else {
    // All attachments.
    if (attachmentsCount() < 1)
      return [];

    bucketList = document.getElementById("attachmentBucket");
    listItems = [...bucketList.querySelectorAll("attachmentitem")];
  }

  if (aAscending) {
    listItems.sort(
      (a, b) => bucketList.getIndexOfItem(a) - bucketList.getIndexOfItem(b));
  } else { // descending
    listItems.sort(
      (a, b) => bucketList.getIndexOfItem(b) - bucketList.getIndexOfItem(a));
  }
  return listItems;
}

/**
 * Returns a sorted-by-index, "non-live" array of selected attachment list items.
 *
 * @param aAscending {boolean}: true (default): sort return array ascending
 *                              false         : sort return array descending
 * @return {array} an array of selected listitem elements in attachmentBucket
 *                 listbox, "non-live" and sorted by their index in the list;
 *                 [] if no attachments selected
 */
function attachmentsSelectionGetSortedArray(aAscending = true)
{
  return attachmentsGetSortedArray(aAscending, true);
}

/**
 * Return true if the selected attachment items are a coherent block in the list,
 * otherwise false.
 *
 * @param aListPosition (optional)  "top"   : Return true only if the block is
 *                                            at the top of the list.
 *                                  "bottom": Return true only if the block is
 *                                            at the bottom of the list.
 * @return {boolean} true : The selected attachment items are a coherent block
 *                          (at the list edge if/as specified by 'aListPosition'),
 *                          or only 1 item selected.
 *                   false: The selected attachment items are NOT a coherent block
 *                          (at the list edge if/as specified by 'aListPosition'),
 *                          or no attachments selected, or no attachments,
 *                          or no attachmentBucket.
 */
function attachmentsSelectionIsBlock(aListPosition)
{
  let selectedCount = attachmentsSelectedCount();
  if (selectedCount < 1)
    // No attachments selected, no attachments, or no attachmentBucket.
    return false;

  let bucketList = document.getElementById("attachmentBucket");
  let selItems = attachmentsSelectionGetSortedArray();
  let indexFirstSelAttachment =
    bucketList.getIndexOfItem(selItems[0]);
  let indexLastSelAttachment =
    bucketList.getIndexOfItem(selItems[selectedCount - 1]);
  let isBlock = ((indexFirstSelAttachment) ==
                 (indexLastSelAttachment + 1 - selectedCount));

  switch (aListPosition) {
  case "top":
    // True if selection is a coherent block at the top of the list.
    return (indexFirstSelAttachment == 0) && isBlock;
  case "bottom":
    // True if selection is a coherent block at the bottom of the list.
    return (indexLastSelAttachment == (attachmentsCount() - 1)) && isBlock;
  default:
    // True if selection is a coherent block.
    return isBlock;
  }
}

function AttachPage()
{
  let result = {value:"http://"};
  if (Services.prompt.prompt(window,
                      getComposeBundle().getString("attachPageDlogTitle"),
                      getComposeBundle().getString("attachPageDlogMessage"),
                      result,
                      null,
                      {value:0}))
  {
    if (result.value.length <= "http://".length)
    {
      // Nothing filled, just show the dialog again.
      AttachPage();
      return;
    }

    let attachment = Cc["@mozilla.org/messengercompose/attachment;1"]
                       .createInstance(Ci.nsIMsgAttachment);
    attachment.url = result.value;
    AddAttachments([attachment]);
  }
}

/**
 * Check if the given fileURL already exists in the attachment bucket.
 * @param fileURL the URL (as a String) of the file to check
 * @return true if the fileURL is already attached
 */
function DuplicateFileAlreadyAttached(fileURL)
{
  var bucket = document.getElementById('attachmentBucket');
  let rowCount = bucket.getRowCount();
  for (let i = 0; i < rowCount; i++)
  {
    let attachment = bucket.getItemAtIndex(i).attachment;
    if (attachment && attachment.url == fileURL)
      return true;
  }
  return false;
}

function Attachments2CompFields(compFields)
{
  var bucket = document.getElementById('attachmentBucket');

  //First, we need to clear all attachment in the compose fields
  compFields.removeAttachments();

  let rowCount = bucket.getRowCount();
  for (let i = 0; i < rowCount; i++)
  {
    let attachment = bucket.getItemAtIndex(i).attachment;
    if (attachment)
      compFields.addAttachment(attachment);
  }
}

function RemoveAllAttachments()
{
  // Ensure that attachment pane is shown before removing all attachments.
  toggleAttachmentPane("show");

  let bucket = document.getElementById("attachmentBucket");
  if (bucket.itemCount == 0)
    return;

  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Ci.nsIFileProtocolHandler);
  let removedAttachments = Cc["@mozilla.org/array;1"]
                             .createInstance(Ci.nsIMutableArray);

  while (bucket.itemCount > 0) {
    let item = bucket.removeItemAt(bucket.itemCount - 1);
    if (item.attachment.size != -1) {
      gAttachmentsSize -= item.attachment.size;
    }

    if (item.attachment.sendViaCloud && item.cloudProvider) {
      let originalUrl = item.originalUrl;
      if (!originalUrl)
        originalUrl = item.attachment.url;
      let file = fileHandler.getFileFromURLSpec(originalUrl);
      if (item.uploading)
        item.cloudProvider.cancelFileUpload(file);
      else
        item.cloudProvider.deleteFile(file,
          new deletionListener(item.attachment, item.cloudProvider));
    }

    removedAttachments.appendElement(item.attachment);
    // Let's release the attachment object hold by the node else it won't go
    // away until the window is destroyed.
    item.attachment = null;
  }

  if (removedAttachments.length > 0) {
    // Bug workaround: Force update of selectedCount and selectedItem.
    bucket.clearSelection();

    AttachmentsChanged();
    dispatchAttachmentBucketEvent("attachments-removed", removedAttachments);
  }
}

/**
 * Show or hide the attachment pane after updating its header bar information
 * (number and total file size of attachments) and tooltip.
 *
 * @param aShowBucket {Boolean} true: show the attachment pane
 *                              false (or omitted): hide the attachment pane
 */
function UpdateAttachmentBucket(aShowBucket)
{
  updateAttachmentPane(aShowBucket ? "show" : "hide");
}

/**
 * Update the header bar information (number and total file size of attachments)
 * and tooltip of attachment pane, then (optionally) show or hide the pane.
 *
 * @param aShowPane {string} "show":  show the attachment pane
 *                           "hide":  hide the attachment pane
 *                           omitted: just update without changing pane visibility
 */
function updateAttachmentPane(aShowPane)
{
  let bucket = GetMsgAttachmentElement();
  let bucketCountLabel = document.getElementById("attachmentBucketCount");
  let words = getComposeBundle().getString("attachmentCount");
  let count = bucket.itemCount;
  let countStr = PluralForm.get(count, words).replace("#1", count);

  bucketCountLabel.value = countStr;
  document.getElementById("attachmentBucketSize").value =
    (count > 0) ? gMessenger.formatFileSize(gAttachmentsSize)
                : "";
  document.getElementById("attachmentBucketCloseButton").collapsed = count > 0;

  let placeholderTooltip = (count > 0) ? countStr : "";
  document.getElementById("attachments-placeholder-box")
          .setAttribute("tooltiptext", placeholderTooltip);

  attachmentBucketUpdateTooltips();

  // If aShowPane argument is omitted, it's just updating, so we're done.
  if (aShowPane === undefined)
    return;

  // Otherwise, show or hide the panel per aShowPane argument.
  toggleAttachmentPane(aShowPane);
}

function RemoveSelectedAttachment()
{
  let bucket = GetMsgAttachmentElement();
  if (bucket.selectedCount == 0)
    return;

  // Remember the current focus index so we can try to restore it when done.
  let focusIndex = bucket.currentIndex;

  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Ci.nsIFileProtocolHandler);
  let removedAttachments = Cc["@mozilla.org/array;1"]
                             .createInstance(Ci.nsIMutableArray);

  for (let i = bucket.selectedCount - 1; i >= 0; i--) {
    let item = bucket.removeItemAt(bucket.getIndexOfItem(bucket.getSelectedItem(i)));
    if (item.attachment.size != -1) {
      gAttachmentsSize -= item.attachment.size;
    }

    if (item.attachment.sendViaCloud && item.cloudProvider) {
      let originalUrl = item.originalUrl;
      if (!originalUrl)
        originalUrl = item.attachment.url;
      let file = fileHandler.getFileFromURLSpec(originalUrl);
      if (item.uploading)
        item.cloudProvider.cancelFileUpload(file);
      else
        item.cloudProvider.deleteFile(file,
          new deletionListener(item.attachment, item.cloudProvider));
    }

    removedAttachments.appendElement(item.attachment);
    // Let's release the attachment object held by the node else it won't go
    // away until the window is destroyed
    item.attachment = null;
  }

  // Bug workaround: Force update of selectedCount and selectedItem, both wrong
  // after item removal, to avoid confusion for listening command controllers.
  bucket.clearSelection();

  // Try to restore original focus or somewhere close by.
  bucket.currentIndex = (focusIndex < bucket.itemCount) ?   // If possible,
                        focusIndex   // restore focus at original position;
                      : ( (bucket.itemCount > 0) ? // else: if attachments exist,
                          (bucket.itemCount - 1)   // focus last item;
                        : -1)                      // else: nothing to focus.

  AttachmentsChanged();
  dispatchAttachmentBucketEvent("attachments-removed", removedAttachments);
}

function RenameSelectedAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  if (bucket.selectedItems.length != 1)
    return; // not one attachment selected

  let item = bucket.getSelectedItem(0);
  let attachmentName = {value: item.attachment.name};
  if (Services.prompt
              .prompt(window,
                      getComposeBundle().getString("renameAttachmentTitle"),
                      getComposeBundle().getString("renameAttachmentMessage"),
                      attachmentName,
                      null,
                      {value: 0}))
  {
    if (attachmentName.value == "")
      return; // name was not filled, bail out

    let originalName = item.attachment.name;
    item.attachment.name = attachmentName.value;
    item.setAttribute("name", attachmentName.value);

    gContentChanged = true;

    let event = document.createEvent("CustomEvent");
    event.initCustomEvent("attachment-renamed", true, true, originalName);
    item.dispatchEvent(event);
  }

  let reorderAttachmentsPanel = document.getElementById("reorderAttachmentsPanel");
  if (reorderAttachmentsPanel.state == "open") {
    // Hack to ensure that reorderAttachmentsPanel does not get closed as we exit.
    bucket.setAttribute("data-ignorenextblur", "true");
  }
  // Update cmd_sortAttachmentsToggle because renaming may change the current
  // sort order.
  goUpdateCommand("cmd_sortAttachmentsToggle");
}

/**
 * Move selected attachment(s) within the attachment list.
 *
 * @param aDirection  "up"        : Move attachments up in the list.
 *                    "down"      : Move attachments down in the list.
 *                    "top"       : Move attachments to the top of the list.
 *                    "bottom"    : Move attachments to the bottom of the list.
 *                    "bundleUp"  : Move attachments together (upwards).
 *                    "bundleDown": Move attachments together (downwards).
 *                    "toggleSort": Sort attachments alphabetically (toggle).
 */
function moveSelectedAttachments(aDirection)
{
  // Command controllers will bail out if no or all attachments are selected,
  // or if block selections can't be moved, or if other direction-specific
  // adverse circumstances prevent the intended movement.

  if (!aDirection)
    return;

  let bucket = document.getElementById("attachmentBucket");

  // Ensure focus on bucket when we're coming from 'Reorder Attachments' panel.
  bucket.focus();

  // Get a sorted and "non-live" array of bucket.selectedItems.
  let selItems = attachmentsSelectionGetSortedArray();

  let visibleIndex = bucket.currentIndex; // In case of misspelled aDirection.
  // Keep track of the item we had focused originally. Deselect it though,
  // since listbox gets confused if you move its focused item around.
  let focusItem = bucket.currentItem;
  bucket.currentItem = null;
  let upwards;
  let targetItem;

  switch (aDirection) {
    case "up":
    case "down":
      // Move selected attachments upwards/downwards.
      upwards = (aDirection == "up") ? true : false;
      let blockItems = [];

      for (let item of selItems) {
        // Handle adjacent selected items en block, via blockItems array.
        blockItems.push(item); // Add current selItem to blockItems.
        let nextItem = item.nextSibling;
        if (!nextItem || !nextItem.selected) {
          // If current selItem is the last blockItem, check out its adjacent
          // item in the intended direction to see if there's room for moving.
          // Note that the block might contain one or more items.
          let checkItem = upwards ?
                          blockItems[0].previousSibling
                        : nextItem;
          // If block-adjacent checkItem exists (and is not selected because
          // then it would be part of the block), we can move the block to the
          // right position.
          if (checkItem) {
            targetItem = upwards ?
                         // Upwards: Insert block items before checkItem,
                         // i.e. before previousSibling of block.
                         checkItem
                         // Downwards: Insert block items *after* checkItem,
                         // i.e. *before* nextSibling.nextSibling of block,
                         // which works according to spec even if that's null.
                       : checkItem.nextSibling;
            // Move current blockItems.
            for (let blockItem of blockItems) {
              bucket.insertBefore(blockItem, targetItem);
            }
          }
          // Else if checkItem doesn't exist, the block is already at the edge
          // of the list, so we can't move it in the intended direction.
          blockItems.length = 0; // Either way, we're done with the current block.
        }
        // Else if current selItem is NOT the end of the current block, proceed:
        // Add next selItem to the block and see if that's the end of the block.
      } // Next selItem.

      // Ensure helpful visibility of moved items (scroll into view if needed):
      // If first item of selection is now at the top, first list item.
      // Else if last item of selection is now at the bottom, last list item.
      // Otherwise, let's see where we are going by ensuring visibility of the
      // nearest unselected sibling of selection according to direction of move.
      visibleIndex = (bucket.getIndexOfItem(selItems[0]) == 0) ? 0
                   : ((bucket.getIndexOfItem(selItems[selItems.length - 1]) ==
                       (bucket.itemCount - 1)) ?
                       (bucket.itemCount - 1)
                     : (upwards ? bucket.getIndexOfItem(selItems[0].previousSibling)
                       : bucket.getIndexOfItem(selItems[selItems.length - 1].nextSibling)
                       )
                     );
      break;

    case "top":
    case "bottom":
    case "bundleUp":
    case "bundleDown":
      // Bundle selected attachments to top/bottom of the list or upwards/downwards.

      upwards = (["top", "bundleUp"].includes(aDirection)) ? true : false;
      // Downwards: Reverse order of selItems so we can use the same algorithm.
      if (!upwards)
        selItems.reverse();

      if (["top", "bottom"].includes(aDirection)) {
        let listEdgeItem = bucket.getItemAtIndex(upwards ? 0 : bucket.itemCount - 1);
        let selEdgeItem = selItems[0];
        if (selEdgeItem != listEdgeItem) {
          // Top/Bottom: Move the first/last selected item to the edge of the list
          // so that we always have an initial anchor target block in the right
          // place, so we can use the same algorithm for top/bottom and
          // inner bundling.
          targetItem = upwards ?
                       // Upwards: Insert before first list item.
                       listEdgeItem
                       // Downwards: Insert after last list item, i.e.
                       // *before* non-existing listEdgeItem.nextSibling,
                       // which is null. It works because it's a feature.
                     : null;
          bucket.insertBefore(selEdgeItem, targetItem);
        }
      }
      // We now have a selected block (at least one item) at the target position.
      // Let's find the end (inner edge) of that block and move only the
      // remaining selected items to avoid unnecessary moves.
      targetItem = null;
      for (let item of selItems) {
        if (targetItem) {
          // We know where to move it, so move it!
          bucket.insertBefore(item, targetItem);
          if (!upwards) {
          // Downwards: As selItems are reversed, and there's no insertAfter()
          // method to insert *after* a stable target, we need to insert
          // *before* the first item of the target block at target position,
          // which is the current selItem which we've just moved onto the block.
          targetItem = item;
          }
        } else {
          // If there's no targetItem yet, find the inner edge of the target block.
          let nextItem = upwards ? item.nextSibling : item.previousSibling;
          if (!nextItem.selected) {
            // If nextItem is not selected, current selItem is the inner edge of
            // the initial anchor target block, so we can set targetItem.
            targetItem = upwards ?
                         // Upwards: set stable targetItem.
                         nextItem
                         // Downwards: set initial targetItem.
                       : item;
          }
          // Else if nextItem is selected, it is still part of initial anchor
          // target block, so just proceed to look for the edge of that block.
        }
      } // next selItem

      // Ensure visibility of first/last selected item after the move.
      visibleIndex = bucket.getIndexOfItem(selItems[0]);
      break;

    case "toggleSort":
      // Sort the selected attachments alphabetically after moving them together.
      // The command updater of cmd_sortAttachmentsToggle toggles the sorting
      // direction based on the current sorting and block status of the selection.

      let toggleCmd = document.getElementById("cmd_sortAttachmentsToggle");
      let sortDirection = toggleCmd.getAttribute("sortdirection") || "ascending";
      let sortItems;
      let sortSelection;

      if (attachmentsSelectedCount() > 1) {
        // Sort selected attachments only.
        sortSelection = true;
        sortItems = selItems;
        // Move selected attachments together before sorting as a block.
        goDoCommand("cmd_moveAttachmentBundleUp");

        // Find the end of the selected block to find our targetItem.
        for (let item of selItems) {
          let nextItem = item.nextSibling;
          if (!nextItem || !nextItem.selected) {
            // If there's no nextItem (block at list bottom), or nextItem is
            // not selected, we've reached the end of the block.
            // Set the block's nextSibling as targetItem and exit loop.
            // Works by definition even if nextSibling aka nextItem is null.
            targetItem = nextItem;
            break;
          }
          // else if (nextItem && nextItem.selected), nextItem is still part of
          // the block, so proceed with checking its nextSibling.
        } // next selItem
      } else {
        // Sort all attachments.
        sortSelection = false;
        sortItems = attachmentsGetSortedArray();
        targetItem = null; // Insert at the end of the list.
      }
      // Now let's sort our sortItems according to sortDirection.
      if (sortDirection == "ascending") {
        sortItems.sort(
          (a, b) => a.attachment.name.localeCompare(b.attachment.name));
      } else { // "descending"
        sortItems.sort(
          (a, b) => b.attachment.name.localeCompare(a.attachment.name));
      }

      // Insert sortItems in new order before the nextSibling of the block.
      for (let item of sortItems) {
        bucket.insertBefore(item, targetItem);
      }


      if (sortSelection) {
        // After sorting selection: Ensure visibility of first selected item.
        visibleIndex = bucket.getIndexOfItem(selItems[0]);
      } else {
        // After sorting all items: Ensure visibility of selected item,
        // otherwise first list item.
        visibleIndex = (selItems.length == 1) ? bucket.selectedIndex
                                              : 0;
      }
      break;
  } // end switch (aDirection)

  // Restore original focus.
  bucket.currentItem = focusItem;
  // Ensure smart visibility of a relevant item according to direction.
  bucket.ensureIndexIsVisible(visibleIndex);

  // Moving selected items around does not trigger auto-updating of our command
  // handlers, so we must do it now as the position of selected items has changed.
  updateReorderAttachmentsItems();
}

function keyToggleAttachmentPaneOnCommand() {
  // For easy and efficient UX with (access key == command key), remember that
  // we're coming from key_toggleAttachmentPane before going into command handling.
  document.getElementById("cmd_toggleAttachmentPane").setAttribute("eventsource",
                                                                   "key");
  goDoCommand("cmd_toggleAttachmentPane");
}

/**
 * Toggle attachment pane view state: show or hide it.
 * If aAction parameter is omitted, toggle current view state.
 *
 * @param aAction {string} "show":   show attachment pane
 *                         "hide":   hide attachment pane
 *                         "toggle": toggle attachment pane visibility
 */
function toggleAttachmentPane(aAction = "toggle") {
  let bucket = GetMsgAttachmentElement();
  let attachmentsBox = document.getElementById("attachments-box");
  let bucketHasFocus = (document.activeElement == bucket);
  let cmdToggleAttachmentPane = document.getElementById("cmd_toggleAttachmentPane");
  let eventSource = cmdToggleAttachmentPane.getAttribute("eventsource");
  cmdToggleAttachmentPane.removeAttribute("eventsource"); // reset eventsource
  let attachmentBucketSizer = document.getElementById("attachmentbucket-sizer");

  if (aAction == "toggle") {
    if (!attachmentsBox.collapsed) {
      // If attachment pane is currently shown:
      if (!bucketHasFocus && eventSource == "key") {
        // If we get here via key_toggleAttachmentPane, here's where we mimick
        // access key functionality: First focus the pane if it isn't focused yet.
        bucket.focus();
      } else {
        // If bucket has focus, or if we get here via menu-click or header-click,
        // just toggle.
        aAction = "hide"
      }
    } else {
      // If attachment pane is currently hidden, show it.
      aAction = "show";
    }
  }

  switch (aAction) {
    case "show":
      attachmentsBox.collapsed = false;
      attachmentBucketSizer.collapsed = false;
      attachmentBucketSizer.setAttribute("state", "");
      if (!bucketHasFocus && eventSource == "key")
        bucket.focus();
      break;

    case "hide":
      if (bucketHasFocus)
        SetMsgBodyFrameFocus();
      attachmentsBox.collapsed = true;
      attachmentBucketSizer.setAttribute("state", "collapsed");
      break;
  }

  goUpdateCommand("cmd_toggleAttachmentPane");
}

function showReorderAttachmentsPanel() {
  // Ensure attachment pane visibility as it might be collapsed.
  toggleAttachmentPane("show");
  showPopupById("reorderAttachmentsPanel", "attachmentBucket",
                "after_start", 15, 0);
  // After the panel is shown, focus attachmentBucket so that keyboard
  // operation for selecting and moving attachment items works; the panel
  // helpfully presents the keyboard shortcuts for moving things around.
  // Bucket focus is also required because the panel will only close with ESC
  // or attachmentBucketOnBlur(), and that's because we're using noautohide as
  // event.preventDefault() of onpopuphiding event fails when the panel
  // is auto-hiding, but we don't want panel to hide when focus goes to bucket.
  document.getElementById("attachmentBucket").focus();
}

/**
 * Returns a string representing the current sort order of selected attachment
 * items by their names. We don't check if selected items form a coherent block
 * or not; use attachmentsSelectionIsBlock() to check on that.
 *
 * @return {string} "ascending" : Sort order is ascending.
 *                  "descending": Sort order is descending.
 *                  "equivalent": The names of all selected items are equivalent.
 *                  ""          : There's no sort order, or only 1 item selected,
 *                                or no items selected, or no attachments,
 *                                or no attachmentBucket.
 */
function attachmentsSelectionGetSortOrder(){
  return attachmentsGetSortOrder(true);
}

/**
 * Returns a string representing the current sort order of attachment items
 * by their names.
 *
 * @param aSelectedOnly {boolean}: true: return sort order of selected items only.
 *                                 false (default): return sort order of all items.
 *
 * @return {string} "ascending" : Sort order is ascending.
 *                  "descending": Sort order is descending.
 *                  "equivalent": The names of the items are equivalent.
 *                  ""          : There's no sort order, or no attachments,
 *                                or no attachmentBucket; or (with aSelectedOnly),
 *                                only 1 item selected, or no items selected.
 */
function attachmentsGetSortOrder(aSelectedOnly = false){
  let listItems;
  if (aSelectedOnly) {
    if (attachmentsSelectedCount() <= 1)
      return "";

    listItems = attachmentsSelectionGetSortedArray();
  } else { // aSelectedOnly == false
    if (attachmentsCount() < 1)
      return "";

    listItems = attachmentsGetSortedArray();
  }

  // We're comparing each item to the next item, so exclude the last item.
  let listItems1 = listItems.slice(0, -1);
  let someAscending;
  let someDescending;

  // Check if some adjacent items are sorted ascending.
  someAscending = listItems1.some((item, index) =>
    item.attachment.name.localeCompare(listItems[index + 1].attachment.name) < 0);

  // Check if some adjacent items are sorted descending.
  someDescending = listItems1.some((item, index) =>
    item.attachment.name.localeCompare(listItems[index + 1].attachment.name) > 0);

  // Unsorted (but not all equivalent in sort order)
  if (someAscending && someDescending)
    return "";

  if (someAscending && !someDescending)
    return "ascending";

  if (someDescending && !someAscending)
    return "descending";

  // No ascending pairs, no descending pairs, so all equivalent in sort order.
  // if (!someAscending && !someDescending)
  return "equivalent";
}

function reorderAttachmentsPanelOnPopupShowing() {
  let panel = document.getElementById("reorderAttachmentsPanel");
  let buttonsNodeList = panel.querySelectorAll(".panelButton");
  let buttons = [...buttonsNodeList]; // convert NodeList to Array
  // Let's add some pretty keyboard shortcuts to the buttons.
  buttons.forEach(btn => {
    if (btn.hasAttribute("key")) {
      btn.setAttribute("prettykey", getPrettyKey(btn.getAttribute("key")));
    }
  })
  // Focus attachment bucket to activate attachmentBucketController, which is
  // required for updating the reorder commands.
  document.getElementById("attachmentBucket").focus();
  // We're updating commands before showing the panel so that button states
  // don't change after the panel is shown, and also because focus is still
  // in attachment bucket right now, which is required for updating them.
  updateReorderAttachmentsItems();
}

function attachmentHeaderContextOnPopupShowing() {
  let initiallyShowItem =
    document.getElementById("attachmentHeaderContext_initiallyShowItem");

  initiallyShowItem.setAttribute("checked", Services.prefs.getBoolPref(
    "mail.compose.show_attachment_pane"));
}

function toggleInitiallyShowAttachmentPane(aMenuItem) {
  Services.prefs.setBoolPref("mail.compose.show_attachment_pane",
                             aMenuItem.getAttribute("checked"));
}

function attachmentBucketOnBlur() {
  // Ensure that reorderAttachmentsPanel remains open while we're focused
  // on attachmentBucket or the panel, otherwise hide it.
  let attachmentBucket = document.getElementById("attachmentBucket");
  if (attachmentBucket.getAttribute("data-ignorenextblur") == "true") {
    // Hack to prevent the panel from hiding after RenameSelectedAttachment()
    attachmentBucket.setAttribute("data-ignorenextblur", "false");
    return;
  }
  let reorderAttachmentsPanel = document.getElementById("reorderAttachmentsPanel");
  if (document.activeElement.id != "attachmentBucket" ||
      document.activeElement.id != "reorderAttachmentsPanel")
    reorderAttachmentsPanel.hidePopup();
}

function attachmentBucketOnKeyPress(aEvent) {
  let bucket = GetMsgAttachmentElement();

  // When ESC is pressed ...
  if (aEvent.key == "Escape") {
    let reorderAttachmentsPanel = document.getElementById("reorderAttachmentsPanel");
    if (reorderAttachmentsPanel.state == "open") {
      // First close reorderAttachmentsPanel if open.
      reorderAttachmentsPanel.hidePopup();
    } else if (bucket.itemCount > 0) {
      if (bucket.selectedCount > 0) {
        // Then deselect selected items in full bucket if any.
        bucket.clearSelection();
      } else {
        // Then unfocus full bucket to continue with msg body.
        SetMsgBodyFrameFocus();
      }
    } else {  // (bucket.itemCount == 0)
      // Otherwise close empty bucket.
      toggleAttachmentPane("hide");
    }
  }

  if (aEvent.key == "Enter" && bucket.itemCount == 0) {
    // Enter on empty bucket to add file attachments, convenience
    // keyboard equivalent of single-click on bucket whitespace.
    goDoCommand("cmd_attachFile");
  }

  // Every locale has a dedicated access key for attachment pane on the
  // "N attachments" label (Windows and Linux). For users' convenience and
  // high mnemonic value, we want the access key combo (e.g. Alt+M) to also work
  // as a shortcut key to toggle the pane (keyboard equivalent of clicking
  // "N attachments" label or pane header).
  // Unfortunately access key intercepts the identical shortcut key, so we have
  // to trigger the shortcut key action here.
  // And we can't use the shortcut key only because removing the control
  // attribute of the label breaks screen readers. Sigh.
  if (AppConstants.platform == "macosx") {
    // Mac does not have localized access keys, so here we're reconstructing the
    // typically non-localized shortcut key, Ctrl+M.
    let attachmentsCommandKeyMac =
      document.getElementById("key_toggleAttachmentPane").getAttribute("key");
    if (aEvent.key == attachmentsCommandKeyMac && aEvent.ctrlKey)
      goDoCommand("cmd_toggleAttachmentPane");
  } else {
    let attachmentsAccessKey = document.getElementById("attachmentBucketCount")
                                       .accessKey;
    // We can get away with hardcoding the access key modifier key as aEvent.altKey
    // because it's ALT for Windows and Linux.
    if (aEvent.key == attachmentsAccessKey && aEvent.altKey)
      goDoCommand("cmd_toggleAttachmentPane");
  }
}

function attachmentBucketOnDragStart(aEvent) {
  nsDragAndDrop.startDrag(aEvent, attachmentBucketDNDObserver);
}

function attachmentBucketOnClick(aEvent)
{
  // Handle click on attachment pane whitespace:
  // - With selected attachments, clear selection first.
  // - Otherwise, e.g. on a plain empty bucket, show 'Attach File(s)' dialog.
  if (attachmentsSelectedCount() == 0) {
    let boundTarget = document.getBindingParent(aEvent.originalTarget);
    if (aEvent.button == 0 && boundTarget && boundTarget.localName == "scrollbox")
      goDoCommand("cmd_attachFile");
  }
}

function attachmentBucketOnSelect() {
  attachmentBucketUpdateTooltips();
  updateAttachmentItems();
}

function attachmentBucketUpdateTooltips() {
  let bucket = GetMsgAttachmentElement();
  let bucketHeader = document.getElementById("attachments-header-box");

  // Attachment pane whitespace tooltip
  if (attachmentsSelectedCount() > 0) {
    bucket.tooltipText=
      getComposeBundle().getString("attachmentBucketClearSelectionTooltip");
  } else {
    bucket.tooltipText=
      getComposeBundle().getString("attachmentBucketAttachFilesTooltip");
  }
}

function attachmentBucketHeaderOnClick(aEvent) {
  if (aEvent.button == 0) {
    // Left click
    goDoCommand("cmd_toggleAttachmentPane");
  }
}

function attachmentBucketCloseButtonOnCommand() {
  toggleAttachmentPane("hide");
}

function attachmentBucketSizerOnMouseUp() {
  updateViewItems();
  if (document.getElementById("attachments-box").collapsed) {
    // If user collapsed the attachment pane, move focus to message body.
    SetMsgBodyFrameFocus();
  }
}

function AttachmentElementHasItems()
{
  var element = document.getElementById("attachmentBucket");
  return element ? (element.getRowCount() > 0) : false;
}

function attachmentBucketMarkEmptyBucket() {
  let attachmentBucket = GetMsgAttachmentElement();
  let attachmentsBox = document.getElementById("attachments-box");
  if (attachmentBucket.itemCount > 0) {
    attachmentsBox.removeAttribute("empty");
  } else {
    attachmentsBox.setAttribute("empty", "true");
  }
}

function OpenSelectedAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  if (bucket.selectedItems.length == 1)
  {
    let attachmentUrl = bucket.getSelectedItem(0).attachment.url;

    let messagePrefix = /^mailbox-message:|^imap-message:|^news-message:/i;
    if (messagePrefix.test(attachmentUrl))
    {
      // we must be dealing with a forwarded attachment, treat this special
      let msgHdr = gMessenger.messageServiceFromURI(attachmentUrl).messageURIToMsgHdr(attachmentUrl);
      if (msgHdr)
        MailUtils.openMessageInNewWindow(msgHdr);
    }
    else
    {
      // Turn the URL into a nsIURI object then open it.
      let uri = Services.io.newURI(attachmentUrl);
      if (uri)
      {
        let channel = Services.io.newChannelFromURI2(uri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
                                                     Ci.nsIContentPolicy.TYPE_OTHER);
        if (channel)
        {
          let uriLoader = Cc["@mozilla.org/uriloader;1"].getService(Ci.nsIURILoader);
          uriLoader.openURI(channel, true, new nsAttachmentOpener());
        }
      }
    }
  } // if one attachment selected
}

function nsAttachmentOpener()
{
}

nsAttachmentOpener.prototype =
{
  QueryInterface: function(iid)
  {
    if (iid.equals(Ci.nsIURIContentListener) ||
        iid.equals(Ci.nsIInterfaceRequestor) ||
        iid.equals(Ci.nsISupports))
        return this;
    throw Cr.NS_NOINTERFACE;
  },

  onStartURIOpen: function(uri)
  {
    return false;
  },

  doContent: function(contentType, isContentPreferred, request, contentHandler)
  {
    // If we came here to display an attached message, make sure we provide a type.
    if (/[?&]part=/i.test(request.URI.query)) {
      let newQuery = request.URI.query + "&type=message/rfc822";
      request.URI = request.URI.mutate().setQuery(newQuery).finalize();
    }
    let newHandler = Cc["@mozilla.org/uriloader/content-handler;1?type=application/x-message-display"]
                       .createInstance(Ci.nsIContentHandler);
    newHandler.handleContent("application/x-message-display", this, request);
    return true;
  },

  isPreferred: function(contentType, desiredContentType)
  {
    if (contentType == "message/rfc822")
      return true;
    return false;
  },

  canHandleContent: function(contentType, isContentPreferred, desiredContentType)
  {
    return false;
  },

  getInterface: function(iid)
  {
    if (iid.equals(Ci.nsIDOMWindow)) {
      return window;
    } else if (iid.equals(Ci.nsIDocShell)) {
      return window.QueryInterface(Ci.nsIInterfaceRequestor)
                   .getInterface(Ci.nsIWebNavigation)
                   .QueryInterface(Ci.nsIDocShell);
    } else {
      return this.QueryInterface(iid);
    }
  },

  loadCookie: null,
  parentContentListener: null
}

/**
 * Check what to do with HTML message according to what preference we have
 * stored for the recipients.
 *
 * @param convertible  An nsIMsgCompConvertible constant describing
 *                     message convertibility to plain text.
 */
function DetermineHTMLAction(convertible)
{
  if (!gMsgCompose.composeHTML)
    return nsIMsgCompSendFormat.PlainText;

  if (gSendFormat == nsIMsgCompSendFormat.AskUser)
    return gMsgCompose.determineHTMLAction(convertible);

  return gSendFormat;
}

/**
 * Expands mailinglists found in the recipient fields.
 */
function expandRecipients()
{
  gMsgCompose.expandMailingLists();
}

function DetermineConvertibility()
{
    if (!gMsgCompose.composeHTML)
        return nsIMsgCompConvertible.Plain;

    try {
        return gMsgCompose.bodyConvertible();
    } catch(ex) {}
    return nsIMsgCompConvertible.No;
}

/**
 * Hides addressing options (To, CC, Bcc, Newsgroup, Followup-To, etc.)
 * that are not relevant for the account type used for sending.
 *
 * @param aAccountKey  Key of the account that is currently selected
 *                     as the sending account.
 */
function hideIrrelevantAddressingOptions(aAccountKey)
{
  let hideNews = true;
  for (let account of fixIterator(MailServices.accounts.accounts,
                                  Ci.nsIMsgAccount)) {
    if (account.incomingServer.type == "nntp")
      hideNews = false;
  }
  // If there is no News (NNTP) account existing then
  // hide the Newsgroup and Followup-To recipient type in all the menulists.
  let addrWidget = document.getElementById("addressingWidget");
  // Only really touch the News related items we know about.
  let newsTypes = addrWidget
    .querySelectorAll('menuitem[value="addr_newsgroups"], menuitem[value="addr_followup"]');
  // Collapsing the menuitem only prevents it getting chosen, it does not
  // affect the menulist widget display when Newsgroup is already selected.
  for (let item of newsTypes) {
    item.collapsed = hideNews;
  }
}

function LoadIdentity(startup)
{
    var identityElement = document.getElementById("msgIdentity");
    var prevIdentity = gCurrentIdentity;

    if (identityElement) {
        var idKey = identityElement.selectedItem.getAttribute("identitykey");
        gCurrentIdentity = MailServices.accounts.getIdentity(idKey);

        let accountKey = null;
        // Set the account key value on the menu list.
        if (identityElement.selectedItem) {
          accountKey = identityElement.selectedItem.getAttribute("accountkey");
          identityElement.setAttribute("accountkey", accountKey);
          hideIrrelevantAddressingOptions(accountKey);
        }

        let maxRecipients = awGetMaxRecipients();
        for (let i = 1; i <= maxRecipients; i++)
        {
          let params = JSON.parse(awGetInputElement(i).searchParam);
          params.idKey = idKey;
          params.accountKey = accountKey;
          awGetInputElement(i).searchParam = JSON.stringify(params);
        }

        if (!startup && prevIdentity && idKey != prevIdentity.key)
        {
          var prevReplyTo = prevIdentity.replyTo;
          var prevCc = "";
          var prevBcc = "";
          var prevReceipt = prevIdentity.requestReturnReceipt;
          var prevDSN = prevIdentity.DSN;
          var prevAttachVCard = prevIdentity.attachVCard;

          if (prevIdentity.doCc)
            prevCc += prevIdentity.doCcList;

          if (prevIdentity.doBcc)
            prevBcc += prevIdentity.doBccList;

          var newReplyTo = gCurrentIdentity.replyTo;
          var newCc = "";
          var newBcc = "";
          var newReceipt = gCurrentIdentity.requestReturnReceipt;
          var newDSN = gCurrentIdentity.DSN;
          var newAttachVCard = gCurrentIdentity.attachVCard;

          if (gCurrentIdentity.doCc)
            newCc += gCurrentIdentity.doCcList;

          if (gCurrentIdentity.doBcc)
            newBcc += gCurrentIdentity.doBccList;

          var needToCleanUp = false;
          var msgCompFields = gMsgCompose.compFields;

          if (!gReceiptOptionChanged &&
              prevReceipt == msgCompFields.returnReceipt &&
              prevReceipt != newReceipt)
          {
            msgCompFields.returnReceipt = newReceipt;
            document.getElementById("returnReceiptMenu").setAttribute('checked',msgCompFields.returnReceipt);
          }

          if (!gDSNOptionChanged &&
              prevDSN == msgCompFields.DSN &&
              prevDSN != newDSN)
          {
            msgCompFields.DSN = newDSN;
            document.getElementById("dsnMenu").setAttribute('checked',msgCompFields.DSN);
          }

          if (!gAttachVCardOptionChanged &&
              prevAttachVCard == msgCompFields.attachVCard &&
              prevAttachVCard != newAttachVCard)
          {
            msgCompFields.attachVCard = newAttachVCard;
            document.getElementById("cmd_attachVCard").setAttribute('checked',msgCompFields.attachVCard);
          }

          if (newReplyTo != prevReplyTo)
          {
            needToCleanUp = true;
            if (prevReplyTo != "")
              awRemoveRecipients(msgCompFields, "addr_reply", prevReplyTo);
            if (newReplyTo != "")
              awAddRecipients(msgCompFields, "addr_reply", newReplyTo);
          }

          let toAddrs = new Set(msgCompFields.splitRecipients(
            msgCompFields.to, true, {}));
          let ccAddrs = new Set(msgCompFields.splitRecipients(
            msgCompFields.cc, true, {}));

          if (newCc != prevCc)
          {
            needToCleanUp = true;
            if (prevCc)
              awRemoveRecipients(msgCompFields, "addr_cc", prevCc);
            if (newCc) {
              // Ensure none of the Ccs are already in To.
              let cc2 = msgCompFields.splitRecipients(newCc, true, {});
              newCc = cc2.filter(x => !toAddrs.has(x)).join(", ");
              awAddRecipients(msgCompFields, "addr_cc", newCc);
            }
          }

          if (newBcc != prevBcc)
          {
            needToCleanUp = true;
            if (prevBcc)
              awRemoveRecipients(msgCompFields, "addr_bcc", prevBcc);
            if (newBcc) {
              // Ensure none of the Bccs are already in To or Cc.
              let bcc2 = msgCompFields.splitRecipients(newBcc, true, {});
              let toCcAddrs = new Set([...toAddrs, ...ccAddrs]);
              newBcc = bcc2.filter(x => !toCcAddrs.has(x)).join(", ");
              awAddRecipients(msgCompFields, "addr_bcc", newBcc);
            }
          }

          if (needToCleanUp)
            awCleanupRows();

          try {
            gMsgCompose.identity = gCurrentIdentity;
          } catch (ex) { dump("### Cannot change the identity: " + ex + "\n");}

          var event = document.createEvent('Events');
          event.initEvent('compose-from-changed', false, true);
          document.getElementById("msgcomposeWindow").dispatchEvent(event);

          gComposeNotificationBar.clearIdentityWarning();
        }

      if (!startup) {
          if (getPref("mail.autoComplete.highlightNonMatches"))
            document.getElementById('addressCol2#1').highlightNonMatches = true;

          // Only do this if we aren't starting up...
          // It gets done as part of startup already.
          addRecipientsToIgnoreList(gCurrentIdentity.fullAddress);

          // If the From field is editable, reset the address from the identity.
          if (identityElement.editable)
          {
            identityElement.value = identityElement.selectedItem.value;
            identityElement.inputField.placeholder = getComposeBundle().getFormattedString("msgIdentityPlaceholder", [identityElement.selectedItem.value]);
          }
      }
    }
}

function MakeFromFieldEditable(ignoreWarning)
{
  if (!ignoreWarning && !getPref("mail.compose.warned_about_customize_from"))
  {
    var check = { value: false };
    if (Services.prompt.confirmEx(window,
          getComposeBundle().getString("customizeFromAddressTitle"),
          getComposeBundle().getString("customizeFromAddressWarning"),
          Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_OK +
          Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL +
          Services.prompt.BUTTON_POS_1_DEFAULT,
          null, null, null,
          getComposeBundle().getString("customizeFromAddressIgnore"),
          check) != 0)
      return;
    Services.prefs.setBoolPref("mail.compose.warned_about_customize_from", check.value);
  }

  var customizeMenuitem = document.getElementById("cmd_customizeFromAddress");
  customizeMenuitem.setAttribute("disabled", "true");
  var identityElement = document.getElementById("msgIdentity");
  identityElement.removeAttribute("type");
  identityElement.editable = true;
  identityElement.focus();
  identityElement.value = identityElement.selectedItem.value;
  identityElement.select();
  identityElement.inputField.placeholder = getComposeBundle().getFormattedString("msgIdentityPlaceholder", [identityElement.selectedItem.value]);
}

function setupAutocomplete()
{
  var autoCompleteWidget = document.getElementById("addressCol2#1");
  try {
    // Request that input that isn't matched be highlighted.
    // This element then gets cloned for subsequent rows, so they should
    // honor it as well.
    if (getPref("mail.autoComplete.highlightNonMatches"))
      autoCompleteWidget.highlightNonMatches = true;
  } catch (ex) {}
}

function fromKeyPress(event)
{
  if (event.keyCode == KeyEvent.DOM_VK_RETURN)
    awSetFocus(1, awGetInputElement(1));
}

function subjectKeyPress(event)
{
  gSubjectChanged = true;
  if (event.keyCode == KeyEvent.DOM_VK_RETURN)
    SetMsgBodyFrameFocus();
}

// we can drag and drop addresses, files, messages and urls into the compose envelope
var envelopeDragObserver = {

  canHandleMultipleItems: true,

  /**
   * Adjust the drop target when dragging from the attachment bucket onto itself
   * by picking the nearest possible insertion point (generally, between two
   * list items).
   *
   * @param aEvent the drag-and-drop event being performed
   * @return {attachmentitem|string} the adjusted drop target:
   *                                 - an attachmentitem node for inserting
   *                                   *before*
   *                                 - "none" if this isn't a valid insertion point
   *                                 - "afterLastItem" for appending at the
   *                                   bottom of the list.
   */
  _adjustDropTarget: function(aEvent)
  {
    let target = aEvent.target;
    let bucket = document.getElementById("attachmentBucket");

    if (target == bucket) {
      // Dragging or dropping at top/bottom border of the listbox
      let box = target.boxObject;
      if ((aEvent.screenY - box.screenY) / box.height < 0.5) {
        target = bucket.firstChild;
      } else {
        target = bucket.lastChild;
      }
      // We'll check below if this is a valid target.
    } else if (target.id == "attachmentBucketCount") {
      // Dragging or dropping at top border of the listbox.
      // Allow bottom half of attachment list header as extended drop target
      // for top of list, because otherwise it would be too small.
      let box = target.boxObject;
      if ((aEvent.screenY - box.screenY) / box.height >= 0.5) {
        target = bucket.firstChild;
        // We'll check below if this is a valid target.
      } else {
        // Top half of attachment list header: sorry, can't drop here.
        return "none";
      }
    }

    // Target is an attachmentitem.
    if (target.tagName == "attachmentitem") {
      // If we're dragging/dropping in bottom half of attachmentitem,
      // adjust target to target.nextSibling (to show dropmarker above that).
      let box = target.boxObject;
      if((aEvent.screenY - box.screenY) / box.height >= 0.5) {
        target = target.nextSibling;

        // If there's no target.nextSibling, we're dragging/dropping
        // to the bottom of the list.
        if (!target) {
          // We can't move a bottom block selection to the bottom.
          if (attachmentsSelectionIsBlock("bottom"))
            return "none";

          // Not a bottom block selection: Target is *after* the last item.
          return "afterLastItem";
        }
      }
      // Check if the adjusted target attachmentitem is a valid target.
      let isBlock = attachmentsSelectionIsBlock();
      let prevItem = target.previousSibling;
      // If target is first list item, there's no previous sibling;
      // treat like unselected previous sibling.
      let prevSelected = prevItem ? prevItem.selected : false;
      if (target.selected && (isBlock || prevSelected) ||
          // target at end of block selection
          isBlock && prevSelected) {
          // We can't move a block selection before/after itself,
          // or any selection onto itself, so trigger dropeffect "none".
          return "none";
      }
      return target;
    }

    return "none";
  },

  _showDropMarker: function(targetItem)
  {
    let bucket = document.getElementById("attachmentBucket");

    let oldDropMarkerItem =
      bucket.querySelector("attachmentitem[dropOn]");
    if (oldDropMarkerItem)
      oldDropMarkerItem.removeAttribute("dropOn");

    if (targetItem == "afterLastItem") {
      targetItem = bucket.lastChild;
      targetItem.setAttribute("dropOn", "bottom");
    } else {
      targetItem.setAttribute("dropOn", "top");
    }
  },

  _hideDropMarker: function()
  {
   let oldDropMarkerItem =
     document.getElementById("attachmentBucket")
             .querySelector("attachmentitem[dropOn]");
    if (oldDropMarkerItem)
      oldDropMarkerItem.removeAttribute("dropOn");
  },

  onDrop: function (aEvent, aData, aDragSession)
  {
    let bucket = document.getElementById("attachmentBucket");
    let dragSourceNode = aDragSession.sourceNode;
    if (dragSourceNode && dragSourceNode.parentNode == bucket) {
      // We dragged from the attachment pane onto itself, so instead of
      // attaching a new object, we're just reordering them.

      // Adjust the drop target according to mouse position on list (items).
      let target = this._adjustDropTarget(aEvent);

      // Get a non-live, sorted list of selected attachment list items.
      let selItems = attachmentsSelectionGetSortedArray();
      // Keep track of the item we had focused originally. Deselect it though,
      // since listbox gets confused if you move its focused item around.
      let focus = bucket.currentItem;
      bucket.currentItem = null;

      // Moving possibly non-coherent multiple selections around correctly
      // is much more complex than one might think...
      if (target.tagName == "attachmentitem" || target == "afterLastItem") {
        // Drop before targetItem in the list, or after last item.
        let blockItems = [];
        let targetItem;
        for (let item of selItems) {
          blockItems.push(item);
          if (target == "afterLastItem") {
            // Original target is the end of the list; append all items there.
            bucket.appendChild(item);
          } else if (target == selItems[0]) {
            // Original target is first item of first selected block.
            if (blockItems.includes(target)) {
              // Item is in first block: do nothing, find the end of the block.
              let nextItem = item.nextSibling;
              if (!nextItem || !nextItem.selected) {
                // We've reached the end of the first block.
                blockItems.length = 0;
                targetItem = nextItem;
              }
            } else {
              // Item is NOT in first block: insert before targetItem,
              // i.e. after end of first block.
              bucket.insertBefore(item, targetItem);
            }
          } else if (target.selected) {
            // Original target is not first item of first block,
            // but first item of another block.
            if (bucket.getIndexOfItem(item) < bucket.getIndexOfItem(target)) {
              // Insert all items from preceding blocks before original target.
              bucket.insertBefore(item, target);
            } else if (blockItems.includes(target)) {
              // target is included in any selected block except first:
              // do nothing for that block, find its end.
              let nextItem = item.nextSibling;
              if (!nextItem || !nextItem.selected) {
                // end of block containing target
                blockItems.length = 0;
                targetItem = nextItem;
              }
            } else {
              // Item from block after block containing target: insert before
              // targetItem, i.e. after end of block containing target.
                bucket.insertBefore(item, targetItem);
            }
          } else { // target != selItems [0]
            // Original target is NOT first item of any block, and NOT selected:
            // Insert all items before the original target.
            bucket.insertBefore(item, target);
          }
        }
      }

      bucket.currentItem = focus;
      this._hideDropMarker();
      return;
    }

    let dataList = aData.dataList;
    let attachments = [];

    for (let dataListObj of dataList)
    {
      let item = dataListObj.first;
      let rawData = item.data;
      let isValidAttachment = false;
      let prettyName;
      let size;

      // We could be dropping an attachment of various flavours OR an address;
      // check and do the right thing.
      // Note that case blocks {...} are recommended to avoid redeclaration errors
      // when using 'let'.
      switch (item.flavour.contentType)
      {
        // Process attachments.
        case "application/x-moz-file": {
          let fileHandler = Services.io
                                    .getProtocolHandler("file")
                                    .QueryInterface(Ci.nsIFileProtocolHandler);
          if (!rawData.exists() || !rawData.isReadable()) {
            // For some reason we couldn't read the file just dragged. Permission problem?
            Cu.reportError("Couldn't access the dragged file " + rawData.leafName);
            break;
          }

          try {
            size = rawData.fileSize;
            rawData = fileHandler.getURLSpecFromFile(rawData);
            isValidAttachment = true;
          } catch (e) {
            Cu.reportError("Couldn't process the dragged file " + rawData.leafName + ":" + e);
          }
          break;
        }

        case "text/x-moz-message": {
          isValidAttachment = true;
          let msgHdr = gMessenger.messageServiceFromURI(rawData)
                                 .messageURIToMsgHdr(rawData);
          prettyName = msgHdr.mime2DecodedSubject + ".eml";
          size = msgHdr.messageSize;
          break;
        }

        case "text/x-moz-url": {
          let pieces = rawData.split("\n");
          rawData = pieces[0];
          if (pieces.length > 1)
            prettyName = pieces[1];
          if (pieces.length > 2)
            size = parseInt(pieces[2]);

          // If this is a URL (or selected text), check if it's a valid URL
          // by checking if we can extract a scheme using Services.io.
          // Don't attach invalid or mailto: URLs.
          try {
            let scheme = Services.io.extractScheme(rawData);
            if (scheme != "mailto")
              isValidAttachment = true;
          }
          catch (ex) {}
          break;
        }

        // Process address: Drop it into recipient field.
        case "text/x-moz-address": {
          if (rawData) {
            DropRecipient(aEvent.target, rawData);

            // Since we are now using ondrop (eDrop) instead of previously using
            // ondragdrop (eLegacyDragDrop), we must prevent the default
            // which is dropping the address text into the widget.
            // Note that stopPropagation() is called by our caller in
            // nsDragAndDrop.js.
            aEvent.preventDefault();
          }
          break;
        }
      }

      // Create the attachment and add it to attachments array.
      if (isValidAttachment) {
        let attachment = Cc["@mozilla.org/messengercompose/attachment;1"]
                           .createInstance(Ci.nsIMsgAttachment);
        attachment.url = rawData;
        attachment.name = prettyName;

        if (size !== undefined)
          attachment.size = size;

        attachments.push(attachment);
      }
    }

    // Add attachments if any.
    if (attachments.length > 0)
      AddAttachments(attachments);

    bucket.focus();
  },

  onDragOver: function (aEvent, aFlavour, aDragSession)
  {
    let bucket = document.getElementById("attachmentBucket");
    let dragSourceNode = aDragSession.sourceNode;
    if (dragSourceNode && dragSourceNode.parentNode == bucket) {
      // If we're dragging from the attachment bucket onto itself, we need to
      // show a drop marker.

      let target = this._adjustDropTarget(aEvent);

      if (target && (target.tagName == "attachmentitem" || target == "afterLastItem")) {
        // Adjusted target is an attachment list item; show dropmarker.
        this._showDropMarker(target);
      } else {
        // target == "none", target is not a listItem, or no target:
        // Indicate that we can't drop here.
        this._hideDropMarker();
        aEvent.dataTransfer.dropEffect = "none";
      }
      return;
    }

    if (aFlavour.contentType != "text/x-moz-address") {
      // Make sure the attachment pane is visible during drag over.
      toggleAttachmentPane("show");
    } else {
      DragAddressOverTargetControl(aEvent);
    }
  },

  onDragExit: function (aEvent, aDragSession)
  {
    this._hideDropMarker();
  },

  getSupportedFlavours: function ()
  {
    let flavourSet = new FlavourSet();
    // Prefer "text/x-moz-address", so when an address from the address book
    // is dragged, this flavour is tested first. Otherwise the attachment
    // bucket would open since the addresses also carry the
    // "application/x-moz-file" flavour.
    flavourSet.appendFlavour("text/x-moz-address");
    flavourSet.appendFlavour("text/x-moz-message");
    flavourSet.appendFlavour("application/x-moz-file", "nsIFile");
    flavourSet.appendFlavour("text/x-moz-url");
    return flavourSet;
  }
};

var attachmentBucketDNDObserver = {
  onDragStart: function (aEvent, aAttachmentData, aDragAction)
  {
    var target = aEvent.target;

    if (target.localName == "attachmentitem")
      aAttachmentData.data = CreateAttachmentTransferData(target.attachment);
  }
};

function DisplaySaveFolderDlg(folderURI)
{
  try
  {
    var showDialog = gCurrentIdentity.showSaveMsgDlg;
  }
  catch (e)
  {
    return;
  }

  if (showDialog){
    let msgfolder = MailUtils.getFolderForURI(folderURI, true);
    if (!msgfolder)
      return;
    let checkbox = {value:0};
    let SaveDlgTitle = getComposeBundle().getString("SaveDialogTitle");
    let dlgMsg = bundle.getFormattedString("SaveDialogMsg",
                                           [msgfolder.name,
                                            msgfolder.server.prettyName]);

    let CheckMsg = bundle.getString("CheckMsg");
    Services.prompt
            .alertCheck(window, SaveDlgTitle, dlgMsg,
                        getComposeBundle().getString("CheckMsg"), checkbox);
    try {
          gCurrentIdentity.showSaveMsgDlg = !checkbox.value;
    }//try
    catch (e) {
    return;
    }//catch

  }//if
  return;
}

function SetMsgAddressingWidgetTreeElementFocus()
{
  let lastRecipientInputElement = awGetInputElement(awGetNumberOfRecipients());
  awSetFocus(awGetNumberOfRecipients(), lastRecipientInputElement);
}

function SetMsgIdentityElementFocus()
{
  GetMsgIdentityElement().focus();
}

function SetMsgSubjectElementFocus()
{
  GetMsgSubjectElement().focus();
}

function SetMsgAttachmentElementFocus()
{
  // Caveat: Callers must ensure that attachment pane is visible.
  GetMsgAttachmentElement().focus();
}

/**
 * Focus the people search input in contacts side bar.
 */
function focusContactsSidebarSearchInput() {
  // Caveat: Callers must ensure that contacts side bar is visible.
  sidebarDocumentGetElementById("peopleSearchInput", "abContactsPanel").focus();
}

function SetMsgBodyFrameFocus()
{
  // window.content.focus() fails to blur the currently focused element
  document.commandDispatcher
          .advanceFocusIntoSubtree(document.getElementById("appcontent"));
}

function GetMsgAddressingWidgetTreeElement()
{
  if (!gMsgAddressingWidgetTreeElement)
    gMsgAddressingWidgetTreeElement = document.getElementById("addressingWidget");

  return gMsgAddressingWidgetTreeElement;
}

function GetMsgIdentityElement()
{
  if (!gMsgIdentityElement)
    gMsgIdentityElement = document.getElementById("msgIdentity");

  return gMsgIdentityElement;
}

function GetMsgSubjectElement()
{
  if (!gMsgSubjectElement)
    gMsgSubjectElement = document.getElementById("msgSubject");

  return gMsgSubjectElement;
}

function GetMsgAttachmentElement()
{
  if (!gMsgAttachmentElement)
    gMsgAttachmentElement = document.getElementById("attachmentBucket");

  return gMsgAttachmentElement;
}

/**
 * Get an element by ID in the current sidebar browser document.
 *
 * @param aId {string}     the ID of the element to get
 * @param aPageId {string} the ID of a <page> in the sidebar <browser>;
 *                         only return the element if the page exists.
 *                         Assuming unique page ids and that there there can
 *                         only ever be one <page> in a <browser>'s src.xul
 *                         (documentation is pretty poor), that means that the
 *                         element will only be returned if it is found in the
 *                         same src.xul as the page (as opposed to any src.xul /
 *                         page currently displayed in the sidebar browser).
 */
function sidebarDocumentGetElementById(aId, aPageId) {
  let sidebarDocument = document.getElementById("sidebar").contentDocument;
  if (aPageId) {
    if (sidebarDocument.getElementById(aPageId)) {
      return sidebarDocument.getElementById(aId);
    }
    return null;
  }
  return sidebarDocument.getElementById(aId);
}

function GetMsgHeadersToolbarElement()
{
  if (!gMsgHeadersToolbarElement)
    gMsgHeadersToolbarElement = document.getElementById("MsgHeadersToolbar");

  return gMsgHeadersToolbarElement;
}

/**
 * Determine which element of the fast-track focus ring has focus.
 * Note that only elements of the fast-track focus ring will be returned.
 *
 * @return an element node of the fast-track focus ring if the node or one of
 *         its descendants has focus, otherwise null.
 */
function WhichElementHasFocus()
{
  let msgIdentityElement = GetMsgIdentityElement();
  let msgAddressingWidgetTreeElement = GetMsgAddressingWidgetTreeElement();
  let msgSubjectElement = GetMsgSubjectElement();
  let msgAttachmentElement = GetMsgAttachmentElement();
  let abContactsPanelElement = sidebarDocumentGetElementById("abContactsPanel");

  if (top.document.commandDispatcher.focusedWindow == content)
    return content;

  let currentNode = top.document.commandDispatcher.focusedElement;
  while (currentNode) {
    if (currentNode == msgIdentityElement ||
        currentNode == msgAddressingWidgetTreeElement ||
        currentNode == msgSubjectElement ||
        currentNode == msgAttachmentElement ||
        currentNode == abContactsPanelElement) {
      return currentNode;
    }
    currentNode = currentNode.parentNode;
  }

  return null;
}

/**
 * Fast-track focus ring: Switch focus between important (not all) elements
 * in the message compose window. Ctrl+[Shift+]Tab | [Shift+]F6 on Windows.
 *
 * The default element to switch to when going in either direction (with or
 * without shift key pressed) is the AddressingWidgetTreeElement.
 *
 * The only exception is when the MsgHeadersToolbar is collapsed,
 * then the focus will always be on the body of the message.
 */
function SwitchElementFocus(event)
{
  let focusedElement = WhichElementHasFocus();

  if (!focusedElement) {
    // None of the pre-defined focus ring elements has focus: This should never
    // happen with the default installation, but might happen with add-ons.
    // In that case, default to focusing the address widget as the first element
    // of the focus ring.
    SetMsgAddressingWidgetTreeElementFocus();
    return;
  }

  if (event && event.shiftKey) {
    // Backwards focus ring: e.g. Ctrl+Shift+Tab | Shift+F6
    switch (focusedElement) {
      case gMsgAddressingWidgetTreeElement:
        SetMsgIdentityElementFocus();
        break;
      case gMsgIdentityElement:
        // Only set focus to the contacts side bar (search box) if it is shown.
        if (!sidebar_is_hidden() &&
            sidebarDocumentGetElementById("abContactsPanel"))
          focusContactsSidebarSearchInput();
        else
          SetMsgBodyFrameFocus();
        break;
      case sidebarDocumentGetElementById("abContactsPanel"):
        SetMsgBodyFrameFocus();
        break;
      case content: // message body
        // Only set focus to the attachment element if it is shown.
        if (!document.getElementById("attachments-box").collapsed)
          SetMsgAttachmentElementFocus();
        else
          SetMsgSubjectElementFocus();
        break;
      case gMsgAttachmentElement:
        SetMsgSubjectElementFocus();
        break;
      default: // gMsgSubjectElement
        SetMsgAddressingWidgetTreeElementFocus();
        break;
    }
  } else {
    // Forwards focus ring: e.g. Ctrl+Tab | F6
    switch (focusedElement) {
      case gMsgAddressingWidgetTreeElement:
        SetMsgSubjectElementFocus();
        break;
      case gMsgSubjectElement:
        // Only set focus to the attachment element if it is shown.
        if (!document.getElementById("attachments-box").collapsed)
          SetMsgAttachmentElementFocus();
        else
          SetMsgBodyFrameFocus();
        break;
      case gMsgAttachmentElement:
        SetMsgBodyFrameFocus();
        break;
      case content:
        // Only set focus to the contacts side bar (search box) if it is shown.
        if (!sidebar_is_hidden() &&
            sidebarDocumentGetElementById("abContactsPanel"))
          focusContactsSidebarSearchInput();
        else
          SetMsgIdentityElementFocus();
        break;
      case sidebarDocumentGetElementById("abContactsPanel"):
        SetMsgIdentityElementFocus();
        break;
      default: // gMsgIdentityElement
        SetMsgAddressingWidgetTreeElementFocus();
        break;
    }
  }
}

function sidebarCloseButtonOnCommand() {
  toggleAddressPicker();
}

function toggleAddressPicker()
{
  // Caveat: This function erroneously assumes that only abContactsPanel can
  // be shown in the sidebar browser, so it will fail if any other src is shown
  // as we do not reliably enforce abContactsPanel.xul as src of the sidebar
  // <browser>. Currently we don't show anything else in the sidebar, but
  // add-ons might.
  let sidebarBox = document.getElementById("sidebar-box");
  let sidebarSplitter = document.getElementById("sidebar-splitter");
  let sidebar = document.getElementById("sidebar");
  let viewAddressPicker = document.getElementById("viewAddressPicker");

  if (sidebarBox.hidden) {
    // Show contacts sidebar.
    sidebarBox.hidden = false;
    sidebarSplitter.hidden = false;
    viewAddressPicker.setAttribute("checked","true");

    let sidebarUrl = sidebar.getAttribute("src");
    // If we have yet to initialize the src URL on the sidebar, then go ahead
    // and do so now... We do this lazily here, so we don't spend time when
    // bringing up the compose window loading the address book data sources.
    // Only when the user opens the address picker, do we set the src URL
    // for the sidebar.
    if (sidebarUrl == "")
      sidebar.setAttribute("src", "chrome://messenger/content/addressbook/abContactsPanel.xul");

    sidebarBox.setAttribute("sidebarVisible", "true");
  } else {
    // Hide contacts sidebar.
    // If something in the sidebar was left marked focused,
    // clear out the attribute so that it does not keep focus in a hidden element.
    let sidebarContent = sidebar.contentDocument;
    let sideFocused = Array.from(sidebarContent.querySelectorAll('[focused="true"]'))
                           .concat(Array.from(sidebarContent.querySelectorAll(":focus")));
    for (let elem of sideFocused) {
      if ("blur" in elem)
        elem.blur();
      elem.removeAttribute("focused");
    }

    sidebarBox.hidden = true;
    sidebarSplitter.hidden = true;
    sidebarBox.setAttribute("sidebarVisible", "false");
    viewAddressPicker.removeAttribute("checked");

    // If nothing is focused in the main compose frame, focus subject if empty
    // otherwise the body. If we didn't do that, focus may stay inside the closed
    // Contacts sidebar and then the main window/frame does not respond to accesskeys.
    // This may be fixed by bug 570835.
    let composerBox = document.getElementById("headers-parent");
    let focusedElement = composerBox.querySelector(":focus") ||
                         composerBox.querySelector('[focused="true"]');
    if (focusedElement) {
      focusedElement.focus();
    } else {
      if (!GetMsgSubjectElement().value)
        SetMsgSubjectElementFocus();
      else
        SetMsgBodyFrameFocus();
    }
  }
}

// Public method called by addons.
function AddRecipient(aRecipientType, aAddress)
{
  awAddRecipientsArray(aRecipientType, [aAddress]);
}

// Public method called by the contants sidebar.
function AddRecipientsArray(aRecipientType, aAddressArray)
{
  awAddRecipientsArray(aRecipientType, aAddressArray);
}

function loadHTMLMsgPrefs()
{
  var fontFace;
  var fontSize;
  var textColor;
  var bgColor;

  try {
    fontFace = getPref("msgcompose.font_face", true);
    doStatefulCommand('cmd_fontFace', fontFace);
  } catch (e) {}

  try {
    fontSize = getPref("msgcompose.font_size");
    EditorSetFontSize(fontSize);
  } catch (e) {}

  var bodyElement = GetBodyElement();

  try {
    textColor = getPref("msgcompose.text_color");
    if (!bodyElement.getAttribute("text"))
    {
    bodyElement.setAttribute("text", textColor);
    gDefaultTextColor = textColor;
    document.getElementById("cmd_fontColor").setAttribute("state", textColor);
    onFontColorChange();
    }
  } catch (e) {}

  try {
    bgColor = getPref("msgcompose.background_color");
    if (!bodyElement.getAttribute("bgcolor"))
    {
    bodyElement.setAttribute("bgcolor", bgColor);
    gDefaultBackgroundColor = bgColor;
    document.getElementById("cmd_backgroundColor").setAttribute("state", bgColor);
    onBackgroundColorChange();
    }
  } catch (e) {}
}

function AutoSave()
{
  if (gMsgCompose.editor && (gContentChanged || gMsgCompose.bodyModified) &&
      !gSendOperationInProgress && !gSaveOperationInProgress)
  {
    GenericSendMessage(nsIMsgCompDeliverMode.AutoSaveAsDraft);
    gAutoSaveKickedIn = true;      
  }

  gAutoSaveTimeout = setTimeout(AutoSave, gAutoSaveInterval);
}

/**
 * Periodically check for keywords in the message.
 */
var gAttachmentNotifier =
{
  _obs: null,

  enabled: false,

  init: function gAN_init(aDocument) {
    if (this._obs)
      this.shutdown();

    this.enabled = getPref("mail.compose.attachment_reminder");
    if (!this.enabled)
      return;

    this._obs = new MutationObserver(function gAN_handleMutations(aMutations) {
      gAttachmentNotifier.timer.cancel();
      gAttachmentNotifier.timer.initWithCallback(gAttachmentNotifier.event, 500,
                                                 Ci.nsITimer.TYPE_ONE_SHOT);
    });

    this._obs.observe(aDocument, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    // Add an input event listener for the subject field since there
    // are ways of changing its value without key presses.
    GetMsgSubjectElement().addEventListener("input",
      this.subjectObserver, true);

    // We could have been opened with a draft message already containing
    // some keywords, so run the checker once to pick them up.
    this.event.notify();
  },

  // Timer based function triggered by the inputEventListener
  // for the subject field.
  subjectObserver: function handleEvent() {
    gAttachmentNotifier.timer.cancel();
    gAttachmentNotifier.timer.initWithCallback(gAttachmentNotifier.event, 500,
                                               Ci.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Checks for new keywords synchronously and run the usual handler.
   *
   * @param aManage  Determines whether to manage the notification according to keywords found.
   */
  redetectKeywords: function(aManage) {
    if (!this.enabled)
      return;

    attachmentWorker.onmessage({ data: this._checkForAttachmentKeywords(false) }, aManage);
  },

  /**
   * Check if there are any keywords in the message.
   *
   * @param async  Whether we should run the regex checker asynchronously or not.
   *
   * @return  If async is true, attachmentWorker.message is called with the array
   *          of found keywords and this function returns null.
   *          If it is false, the array is returned from this function immediately.
   */
  _checkForAttachmentKeywords: function(async)
  {
    if (!this.enabled)
      return (async ? null : []);

    if (attachmentNotificationSupressed()) {
      // If we know we don't need to show the notification,
      // we can skip the expensive checking of keywords in the message.
      // but mark it in the .lastMessage that the keywords are unknown.
      attachmentWorker.lastMessage = null;
      return (async ? null : []);
    }

    let keywordsInCsv = Services.prefs.getComplexValue(
      "mail.compose.attachment_reminder_keywords",
      Ci.nsIPrefLocalizedString).data;
    let mailBody = getBrowser().contentDocument.querySelector("body");

    // We use a new document and import the body into it. We do that to avoid
    // loading images that were previously blocked. Content policy of the newly
    // created data document will block the loads. Details: Bug 1409458 comment #22.
    let newDoc = getBrowser().contentDocument.implementation.createDocument("", "", null);
    let mailBodyNode = newDoc.importNode(mailBody, true);

    // Don't check quoted text from reply.
    let blockquotes = mailBodyNode.getElementsByTagName("blockquote");
    for (let i = blockquotes.length - 1; i >= 0; i--) {
      blockquotes[i].remove();
    }

    // For plaintext composition the quotes we need to find and exclude are
    // <span _moz_quote="true">.
    let spans = mailBodyNode.querySelectorAll("span[_moz_quote]");
    for (let i = spans.length - 1; i >= 0; i--) {
      spans[i].remove();
    }

    // Ignore signature (html compose mode).
    let sigs = mailBodyNode.getElementsByClassName("moz-signature");
    for (let i = sigs.length - 1; i >= 0; i--) {
      sigs[i].remove();
    }

    // Replace brs with line breaks so node.textContent won't pull foo<br>bar
    // together to foobar.
    let brs = mailBodyNode.getElementsByTagName("br");
    for (let i = brs.length - 1; i >= 0; i--) {
      brs[i].parentNode.replaceChild(mailBodyNode.ownerDocument.createTextNode("\n"), brs[i]);
    }

    // Ignore signature (plain text compose mode).
    let mailData = mailBodyNode.textContent;
    let sigIndex = mailData.indexOf("-- \n");
    if (sigIndex > 0)
      mailData = mailData.substring(0, sigIndex);

    // Ignore replied messages (plain text and html compose mode).
    let repText = getComposeBundle().getString("mailnews.reply_header_originalmessage");
    let repIndex = mailData.indexOf(repText);
    if (repIndex > 0)
      mailData = mailData.substring(0, repIndex);

    // Ignore forwarded messages (plain text and html compose mode).
    let fwdText = getComposeBundle().getString("mailnews.forward_header_originalmessage");
    let fwdIndex = mailData.indexOf(fwdText);
    if (fwdIndex > 0)
      mailData = mailData.substring(0, fwdIndex);

    // Prepend the subject to see if the subject contains any attachment
    // keywords too, after making sure that the subject has changed.
    let subject = GetMsgSubjectElement().value;
    if (subject && (gSubjectChanged ||
       (gEditingDraft &&
         (gComposeType == nsIMsgCompType.New ||
         gComposeType == nsIMsgCompType.NewsPost ||
         gComposeType == nsIMsgCompType.Draft ||
         gComposeType == nsIMsgCompType.Template ||
         gComposeType == nsIMsgCompType.EditTemplate ||
         gComposeType == nsIMsgCompType.EditAsNew ||
         gComposeType == nsIMsgCompType.MailToUrl))))
      mailData = subject + " " + mailData;

    if (!async)
      return GetAttachmentKeywords(mailData.toLowerCase(), keywordsInCsv);

    attachmentWorker.postMessage([mailData.toLowerCase(), keywordsInCsv]);
    return null;
  },

  shutdown: function gAN_shutdown() {
    if (this._obs)
      this._obs.disconnect();
    gAttachmentNotifier.timer.cancel();

    this._obs = null;
  },

  event: {
    notify: function(timer)
    {
      // Only run the checker if the compose window is initialized
      // and not shutting down.
      if (gMsgCompose) {
        // This runs the attachmentWorker asynchronously so if keywords are found
        // manageAttachmentNotification is run from attachmentWorker.onmessage.
        gAttachmentNotifier._checkForAttachmentKeywords(true);
      }
    }
  },

  timer: Cc["@mozilla.org/timer;1"]
           .createInstance(Ci.nsITimer)
};

/**
 * Helper function to remove a query part from a URL, so for example:
 * ...?remove=xx&other=yy becomes ...?other=yy.
 *
 * @param aURL    the URL from which to remove the query part
 * @param aQuery  the query part to remove
 * @return        the URL with the query part removed
 */
function removeQueryPart(aURL, aQuery)
{
  // Quick pre-check.
  if (aURL.indexOf(aQuery) < 0)
    return aURL;

  let indexQM = aURL.indexOf("?");
  if (indexQM < 0)
    return aURL;

  let queryParts = aURL.substr(indexQM + 1).split("&");
  let indexPart = queryParts.indexOf(aQuery);
  if (indexPart < 0)
    return aURL;
  queryParts.splice(indexPart, 1);
  return aURL.substr(0, indexQM + 1) + queryParts.join("&");
}

function InitEditor()
{
  var editor = GetCurrentEditor();

  // Set eEditorMailMask flag to avoid using content prefs for spell checker,
  // otherwise dictionary setting in preferences is ignored and dictionary is
  // inconsistent in subject and message body.
  let eEditorMailMask = Ci.nsIPlaintextEditor.eEditorMailMask;
  editor.flags |= eEditorMailMask;
  GetMsgSubjectElement().editor.flags |= eEditorMailMask;

  // Control insertion of line breaks.
  editor.returnInParagraphCreatesNewParagraph =
    Services.prefs.getBoolPref("editor.CR_creates_new_p");
  editor.document.execCommand("defaultparagraphseparator", false,
    gMsgCompose.composeHTML &&
    Services.prefs.getBoolPref("mail.compose.default_to_paragraph") ?
                               "p" : "br");

  editor.QueryInterface(nsIEditorStyleSheets);
  // We use addOverrideStyleSheet rather than addStyleSheet so that we get
  // a synchronous load, rather than having a late-finishing async load
  // mark our editor as modified when the user hasn't typed anything yet,
  // but that means the sheet must not @import slow things, especially
  // not over the network.
  editor.addOverrideStyleSheet("chrome://messenger/content/composerOverlay.css");
  gMsgCompose.initEditor(editor, window.content);

  // We always go through this function every time we init an editor.
  // First step is making sure we can spell check.
  gSpellChecker.init(editor);
  document.getElementById('menu_inlineSpellCheck')
          .setAttribute('disabled', !gSpellChecker.canSpellCheck);
  document.getElementById('spellCheckEnable')
          .setAttribute('disabled', !gSpellChecker.canSpellCheck);
  // If canSpellCheck = false, then hidden = false, i.e. show it so that we can
  // still add dictionaries. Else, hide that.
  document.getElementById('spellCheckAddDictionariesMain')
          .setAttribute('hidden', gSpellChecker.canSpellCheck);
  // Then, we enable related UI entries.
  enableInlineSpellCheck(getPref("mail.spellcheck.inline"));
  gAttachmentNotifier.init(editor.document);

  // Listen for spellchecker changes, set document language to
  // dictionary picked by the user via the right-click menu in the editor.
  document.addEventListener("spellcheck-changed", updateDocumentLanguage);

  // XXX: the error event fires twice for each load. Why??
  editor.document.body.addEventListener("error", function(event) {
    if (event.target.localName != "img") {
      return;
    }

    if (event.target.getAttribute("moz-do-not-send") == "true") {
      return;
    }

    let src = event.target.src;
    if (!src) {
      return;
    }
    if (!/^file:/i.test(src)) {
      // Check if this is a protocol that can fetch parts.
      let protocol = src.substr(0, src.indexOf(":")).toLowerCase();
      if (!(Services.io.getProtocolHandler(protocol) instanceof
            Ci.nsIMsgMessageFetchPartService)) {
        // Can't fetch parts, don't try to load.
        return;
      }
    }

    if (event.target.classList.contains("loading-internal")) {
      // We're already loading this, or tried so unsuccessfully.
      return;
    }
    if (gOriginalMsgURI) {
      let msgSvc = Cc["@mozilla.org/messenger;1"]
        .createInstance(Ci.nsIMessenger)
        .messageServiceFromURI(gOriginalMsgURI);
      let originalMsgNeckoURI = {};
      msgSvc.GetUrlForUri(gOriginalMsgURI, originalMsgNeckoURI, null);
      if (src.startsWith(removeQueryPart(originalMsgNeckoURI.value.spec,
                                         "type=application/x-message-display"))) {
        // Reply/Forward/Edit Draft/Edit as New can contain references to
        // images in the original message. Load those and make them data: URLs
        // now.
        event.target.classList.add("loading-internal");
        try {
          loadBlockedImage(src);
        } catch (e) {
          // Couldn't load the referenced image.
          Cu.reportError(e);
        }
      }
      else {
        // Appears to reference a random message. Notify and keep blocking.
        gComposeNotificationBar.setBlockedContent(src);
      }
    }
    else {
      // For file:, and references to parts of random messages, show the
      // blocked content notification.
      gComposeNotificationBar.setBlockedContent(src);
    }
  }, true);

  // Convert mailnews URL back to data: URL.
  let background = editor.document.body.background;
  if (background && gOriginalMsgURI) {
    // Check that background has the same URL as the message itself.
    let msgSvc = Cc["@mozilla.org/messenger;1"]
      .createInstance(Ci.nsIMessenger)
      .messageServiceFromURI(gOriginalMsgURI);
    let originalMsgNeckoURI = {};
    msgSvc.GetUrlForUri(gOriginalMsgURI, originalMsgNeckoURI, null);
    if (background.startsWith(
        removeQueryPart(originalMsgNeckoURI.value.spec,
                        "type=application/x-message-display"))) {
      try {
        editor.document.body.background = loadBlockedImage(background, true);
      } catch (e) {
        // Couldn't load the referenced image.
        Cu.reportError(e);
      }
    }
  }
}

// This is used as event listener to spellcheck-changed event to update
// document language.
function updateDocumentLanguage(e)
{
  document.documentElement.setAttribute("lang", e.detail.dictionary);
}

// This function modifies gSpellChecker and updates the UI accordingly. It's
// called either at startup (see InitEditor above), or when the user clicks on
// one of the two menu items that allow them to toggle the spellcheck feature
// (either context menu or Options menu).
function enableInlineSpellCheck(aEnableInlineSpellCheck)
{
  if (gSpellChecker.enabled != aEnableInlineSpellCheck) {
    // If state of spellchecker is about to change, clear any pending observer.
    spellCheckReadyObserver.removeObserver();
  }
  gSpellChecker.enabled = aEnableInlineSpellCheck;
  document.getElementById('msgSubject').setAttribute('spellcheck', aEnableInlineSpellCheck);
  document.getElementById("menu_inlineSpellCheck")
          .setAttribute('checked', aEnableInlineSpellCheck);
  document.getElementById("spellCheckEnable")
          .setAttribute('checked', aEnableInlineSpellCheck);
  document.getElementById('spellCheckDictionaries')
          .setAttribute('hidden', !aEnableInlineSpellCheck);
}

function getMailToolbox()
{
  return document.getElementById("compose-toolbox");
}

function getPref(aPrefName, aIsComplex) {
  if (aIsComplex) {
    return Services.prefs.getStringPref(aPrefName);
  }
  switch (Services.prefs.getPrefType(aPrefName)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getCharPref(aPrefName);
    default: // includes nsIPrefBranch.PREF_INVALID
      return null;
  }
}

/**
 * Helper function to dispatch a CustomEvent to the attachmentbucket.
 *
 * @param aEventType the name of the event to fire.
 * @param aData any detail data to pass to the CustomEvent.
 */
function dispatchAttachmentBucketEvent(aEventType, aData) {
  let bucket = document.getElementById("attachmentBucket");
  let event = document.createEvent("CustomEvent");
  event.initCustomEvent(aEventType, true, true, aData);
  bucket.dispatchEvent(event);
}

/** Update state of zoom type (text vs. full) menu item. */
function UpdateFullZoomMenu() {
  let menuItem = document.getElementById("menu_fullZoomToggle");
  menuItem.setAttribute("checked", !ZoomManager.useFullZoom);
}

/**
 * Return the <editor> element of the mail compose window. The name is somewhat
 * unfortunate; we need to maintain it since the zoom manager, view source and
 * other functions still rely on it.
 */
function getBrowser()
{
  return document.getElementById("content-frame");
}

function goUpdateMailMenuItems(commandset)
{
  for (let i = 0; i < commandset.childNodes.length; i++)
  {
    let commandID = commandset.childNodes[i].getAttribute("id");
    if (commandID)
      goUpdateCommand(commandID);
  }
}

/**
 * Object to handle message related notifications that are showing in a
 * notificationbox below the composed message content.
 */
var gComposeNotificationBar = {
  get brandBundle() {
    delete this.brandBundle;
    return this.brandBundle = document.getElementById("brandBundle");
  },

  get notificationBar() {
    delete this.notificationBar;
    return this.notificationBar = document.getElementById("attachmentNotificationBox");
  },

  setBlockedContent: function(aBlockedURI) {
    let brandName = this.brandBundle.getString("brandShortName");
    let buttonLabel = getComposeBundle().getString((AppConstants.platform == "win") ?
      "blockedContentPrefLabel" : "blockedContentPrefLabelUnix");
    let buttonAccesskey = getComposeBundle().getString((AppConstants.platform == "win") ?
      "blockedContentPrefAccesskey" : "blockedContentPrefAccesskeyUnix");

    let buttons = [{
      label: buttonLabel,
      accessKey: buttonAccesskey,
      popup: "blockedContentOptions",
      callback: function(aNotification, aButton) {
        return true; // keep notification open
      }
    }];

    // The popup value is a space separated list of all the blocked urls.
    let popup = document.getElementById("blockedContentOptions");
    let urls = popup.value ? popup.value.split(" ") : [];
    if (!urls.includes(aBlockedURI))
      urls.push(aBlockedURI);
    popup.value = urls.join(" ");

    let msg = getComposeBundle().getFormattedString(
      "blockedContentMessage", [brandName, brandName]);
    msg = PluralForm.get(urls.length, msg);

    if (!this.isShowingBlockedContentNotification()) {
      this.notificationBar.appendNotification(msg, "blockedContent",
        null, this.notificationBar.PRIORITY_WARNING_MEDIUM, buttons);
    }
    else {
      this.notificationBar.getNotificationWithValue("blockedContent").setAttribute("label", msg);
    }
  },

  isShowingBlockedContentNotification: function() {
    return !!this.notificationBar.getNotificationWithValue("blockedContent");
  },

  clearBlockedContentNotification: function() {
    this.notificationBar.removeNotification(
      this.notificationBar.getNotificationWithValue("blockedContent"));
  },

  clearNotifications: function(aValue) {
    this.notificationBar.removeAllNotifications(true);
  },

  setIdentityWarning: function(aIdentityName) {
    if (!this.notificationBar.getNotificationWithValue("identityWarning")) {
      let text = getComposeBundle().getString("identityWarning")
                                   .split("%S");
      let label = new DocumentFragment();
      label.appendChild(document.createTextNode(text[0]));
      label.appendChild(document.createElement("b"));
      label.lastChild.appendChild(document.createTextNode(aIdentityName));
      label.appendChild(document.createTextNode(text[1]));
      this.notificationBar.appendNotification(label, "identityWarning", null,
        this.notificationBar.PRIORITY_WARNING_HIGH, null);
    }
  },

  clearIdentityWarning: function() {
    let idWarning = this.notificationBar.getNotificationWithValue("identityWarning");
    if (idWarning)
      this.notificationBar.removeNotification(idWarning);
  }
};

/**
 * Populate the menuitems of what blocked content to unblock.
 */
function onBlockedContentOptionsShowing(aEvent) {
  let urls = aEvent.target.value ? aEvent.target.value.split(" ") : [];

  // Out with the old...
  let childNodes = aEvent.target.childNodes;
  for (let i = childNodes.length - 1; i >= 0; i--) {
    childNodes[i].remove();
  }

  // ... and in with the new.
  for (let url of urls) {
    let menuitem = document.createElement("menuitem");
    menuitem.setAttribute("label",
      getComposeBundle().getFormattedString("blockedAllowResource", [url]));
    menuitem.setAttribute("crop", "center");
    menuitem.setAttribute("value", url);
    menuitem.setAttribute("oncommand",
                          "onUnblockResource(this.value, this.parentNode);");
    aEvent.target.appendChild(menuitem);
  }
}

/**
 * Handle clicking the "Load <url>" in the blocked content notification bar.
 * @param {String} aURL - the URL that was unblocked
 * @param {Node} aNode  - the node holding as value the URLs of the blocked
 *                        resources in the message (space separated).
 */
function onUnblockResource(aURL, aNode) {
  try {
    loadBlockedImage(aURL);
  } catch (e) {
    // Couldn't load the referenced image.
    Cu.reportError(e);
  } finally {
    // Remove it from the list on success and failure.
    let urls = aNode.value.split(" ");
    for (let i = 0; i < urls.length; i++) {
      if (urls[i] == aURL) {
        urls.splice(i, 1);
        aNode.value = urls.join(" ");
        if (urls.length == 0) {
          gComposeNotificationBar.clearBlockedContentNotification();
        }
        break;
      }
    }
  }
}

// mantis 2749 Emetteur par défaut d'un message émis depuis le dossier modèle
function GetDefaultIdentityForMsgHdr(msghdr) {

  return MailServices.accounts.getFirstIdentityForServer(msghdr.folder.server);
}

// mantis 0004983: Expéditeur non modifié lors du déplacement d'1 message dans une autre boîte
function cm2IsFolderDraftTemplate(folder){
  
  const Ci=Components.interfaces;  
  let dossier=folder;
  while (!dossier.isServer){   
    if (dossier.getFlag(Ci.nsMsgFolderFlags.Drafts|Ci.nsMsgFolderFlags.Templates))
      return true;
    dossier=dossier.parent;
  }
  
  return false;
}


/**
 * Convert the blocked content to a data URL and swap the src to that for the
 * elements that were using it.
 *
 * @param {String}  aURL - (necko) URL to unblock
 * @param {Bool}    aReturnDataURL - return data: URL instead of processing image
 * @return {String} the image as data: URL.
 * @throw Error()   if reading the data failed
 */
function loadBlockedImage(aURL, aReturnDataURL = false) {
  let filename;
  if (/^(file|chrome):/i.test(aURL)) {
    filename = aURL.substr(aURL.lastIndexOf("/") + 1);
  }
  else {
    let fnMatch = /[?&;]filename=([^?&]+)/.exec(aURL);
    filename = (fnMatch && fnMatch[1]) || "";
  }
  filename = decodeURIComponent(filename);
  let uri = Services.io.newURI(aURL);
  let contentType;
  if (filename) {
    try {
      contentType = Cc["@mozilla.org/mime;1"]
        .getService(Ci.nsIMIMEService)
        .getTypeFromURI(uri);
    } catch (ex) {
      contentType = "image/png";
    }

    if (!contentType.startsWith("image/")) {
      // Unsafe to unblock this. It would just be garbage either way.
      throw new Error("Won't unblock; URL=" + aURL +
                      ", contentType=" + contentType);
    }
  }
  else {
    // Assuming image/png is the best we can do.
    contentType = "image/png";
  }
  let channel = Services.io.newChannelFromURI2(uri,
    null,
    Services.scriptSecurityManager.getSystemPrincipal(),
    null,
    Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
    Ci.nsIContentPolicy.TYPE_OTHER);
  let inputStream = channel.open();
  let stream = Cc["@mozilla.org/binaryinputstream;1"]
    .createInstance(Ci.nsIBinaryInputStream);
  stream.setInputStream(inputStream);
  let streamData = "";
  try {
    while (stream.available() > 0) {
      streamData += stream.readBytes(stream.available());
    }
  } catch(e) {
    stream.close();
    throw new Error("Couln't read all data from URL=" + aURL + " (" + e +")");
  }
  stream.close();
  let encoded = btoa(streamData);
  let dataURL = "data:" + contentType +
    (filename ? ";filename=" + encodeURIComponent(filename) : "") +
    ";base64," + encoded;

  if (aReturnDataURL)
    return dataURL;

  let editor = GetCurrentEditor();
  for (let img of editor.document.images) {
    if (img.src == aURL) {
      img.src = dataURL; // Swap to data URL.
      img.classList.remove("loading-internal");
    }
  }
}
