/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Home Dash.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Edward Lee <edilee@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";
const global = this;

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Services.jsm");

// Keep a reference to various packaged images
const images = {};

/**
 * Remove all existing chrome of the browser window
 */
function removeChrome(window) {
  function change(obj, prop, val) {
    let orig = obj[prop];
    obj[prop] = val;
    unload(function() obj[prop] = orig, window);
  }

  // Make sure the navigation bar isn't hidden on pages like about:addons
  change(window.TabsOnTop, "enabled", false);

  // Wait a bit for the UI to flow to grab the right size
  Utils.delay(function() {
    let {gBrowser} = window;
    let style = gBrowser.style;
    change(style, "marginTop", -gBrowser.boxObject.y + "px");
    change(style, "position", "relative");
    change(style, "zIndex", "1");
  });
}

/**
 * Add a dashboard that shows up over the main browsing area
 */
function addDashboard(window) {
  let {clearInterval, document, gBrowser, setInterval} = window;

  function createNode(node) {
    const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    return document.createElementNS(XUL, node);
  }

  let sixthWidth = gBrowser.boxObject.width / 6;

  //// Add master stack containing all 7 layers of the dashboard

  let masterStack = createNode("stack");
  masterStack.style.overflow = "hidden";
  masterStack.style.pointerEvents = "none";

  // Add the stack to the current tab on first load
  masterStack.move = function() {
    gBrowser.selectedBrowser.parentNode.appendChild(masterStack);
  };
  masterStack.move();
  unload(function() masterStack.parentNode.removeChild(masterStack), window);

  // Make sure we're in the right tab stack whenever the tab switches
  listen(window, gBrowser.tabContainer, "TabSelect", masterStack.move);

  //// 1: Search preview #1

  // Create a preview-stack and add it to the master stack
  function createPreviewStack(left, right) {
    // Previews consist of the browser and a click-screen contained in a stack
    let stack = createNode("stack");
    stack.setAttribute("left", left + "");
    stack.setAttribute("right", right + "");
    masterStack.appendChild(stack);
    stack.collapsed = true;

    // Create and set some common preview listeners and attributes
    let browser = stack.browser = createNode("browser");
    browser.addEventListener("DOMTitleChanged", function(event) {
      event.stopPropagation();
    }, true);
    browser.setAttribute("disablehistory", "true");
    browser.setAttribute("type", "content");
    browser.style.overflow = "hidden";
    stack.appendChild(browser);

    // Put a screen over the browser to accept clicks
    let screen = stack.screen = createNode("box");
    screen.style.pointerEvents = "auto";
    stack.appendChild(screen);

    // Save the preview when clicked
    screen.addEventListener("click", function() {
      // TODO swapDocShell stuff
      gBrowser.selectedBrowser.setAttribute("src", browser.getAttribute("src"));
      dashboard.open = false;
    }, false);

    // Indicate what clicking will do
    screen.addEventListener("mouseover", function() {
      statusLine.set("select", browser.contentDocument.title);
    }, false);

    screen.addEventListener("mouseout", function() {
      statusLine.set();
    }, false);

    // Create a set of callbacks to add/remove load a listener
    function addLoadListener() {
      stack.browser.addEventListener("DOMContentLoaded", handleLoad, false);
    }

    function removeLoadListener() {
      stack.browser.removeEventListener("DOMContentLoaded", handleLoad, false);
    }

    // Show the preview when content is loaded
    function handleLoad() {
      removeLoadListener();
      stack.collapsed = false;
    }

    // Provide a way to load a url into the preview
    stack.load = function(url) {
      // Nothing to load, so hide
      if (url == null || url == "") {
        stack.reset();
        return;
      }

      // If we're already on the right url, just show it
      if (url == stack.browser.getAttribute("src")) {
        stack.collapsed = false;
        return;
      }

      // Start loading the provided url
      stack.browser.setAttribute("src", url);

      // Wait until the page loads to show the preview
      if (stack.collapsed)
        addLoadListener();
    };

    // Hide and stop the preview
    stack.reset = function() {
      stack.collapsed = true;

      // We might have a load listener if we just started a preview
      // NB: Don't clear the attribute so re-showing the same page is fast
      if (stack.browser.getAttribute("src") != "")
        removeLoadListener();

      // Stop the preview in-case it's loading, but only if we can
      if (stack.browser.stop != null)
        stack.browser.stop();
    };

    return stack;
  }

  let searchPreview1 = createPreviewStack(0, 2 * sixthWidth);

  //// 2: Search preview #2

  let searchPreview2 = createPreviewStack(3 * sixthWidth, -sixthWidth);

  // Add some helper properties and functions to search previews
  function addSearchFunctionality(searchPreview) {
    // Helper to update engine icon state when changing
    Object.defineProperty(searchPreview, "engineIcon", {
      get: function() searchPreview._engineIcon,
      set: function(val) {
        // Inform the icon to deactivate if being replaced
        if (searchPreview.engineIcon != null)
          searchPreview.engineIcon.active = false;

        // Save the engine icon to the preview
        searchPreview._engineIcon = val;

        // Inform the icon to activate
        if (searchPreview.engineIcon != null)
          searchPreview.engineIcon.active = true;
      }
    });

    // Handle search queries to show a preview
    searchPreview.search = function(query) {
      // Nothing to search or to search with, so hide
      if (query == null || query == "" || searchPreview.engineIcon == null) {
        searchPreview.reset();
        return;
      }

      // Use the search engine to get a url and show it
      searchPreview.load(searchPreview.engineIcon.getSearchUrl(query));
    };
  }

  addSearchFunctionality(searchPreview1);
  addSearchFunctionality(searchPreview2);

  //// 3: Page and tab previews

  let pagePreview = createPreviewStack(2 * sixthWidth, -sixthWidth);

  //// 4: Main dashboard

  let dashboard = createNode("stack");
  masterStack.appendChild(dashboard);

  dashboard.collapsed = true;
  dashboard.style.backgroundColor = "rgba(0, 0, 0, .3)";
  dashboard.style.pointerEvents = "none";

  // Helper to check if the dashboard is open
  Object.defineProperty(dashboard, "open", {
    get: function() !dashboard.collapsed,
    set: function(val) {
      // Don't do work if we're already of that state
      val = !!val;
      if (val == dashboard.open)
        return;

      // Hide if already open
      if (dashboard.open) {
        dashboard.collapsed = true;
        gBrowser.selectedBrowser.focus();
        fxIcon.reset();
        input.reset();
        notifications.paused = false;
        pagePreview.reset();
        searchPreview1.reset();
        searchPreview2.reset();
        sites.reset();
      }
      // Show if currently closed
      else {
        dashboard.collapsed = false;
        dashboard.focus();
        input.focus();
        notifications.paused = true;
      }
    }
  });

  // Helper to toggle the dashboard open/close
  dashboard.toggle = function() {
    dashboard.open = !dashboard.open;
  };

  //// 4.1: Search controls

  let searchBox = createNode("vbox");
  searchBox.setAttribute("left", "30");
  searchBox.setAttribute("right", Math.ceil(4 * sixthWidth) + "");
  searchBox.setAttribute("top", "30");
  dashboard.appendChild(searchBox);

  searchBox.style.backgroundColor = "rgba(224, 224, 224, .3)";
  searchBox.style.borderRadius = "5px";
  searchBox.style.padding = "5px";
  searchBox.style.pointerEvents = "auto";

  let input = createNode("textbox");
  input.setAttribute("left", "30");
  input.setAttribute("top", "30");
  searchBox.appendChild(input);

  input.setAttribute("timeout", "1");
  input.setAttribute("type", "search");

  // Allow clearing out any old search results
  input.reset = function() {
    input.nextPreview = 2;
    input.value = "";
    searchPreview1.engineIcon = null;
    searchPreview2.engineIcon = null;
  };
  input.reset();

  // Allow toggling a search engine (up to two visible at a time)
  input.toggleEngine = function(engineIcon) {
    // Set the new engine for the preview and what preview to use next
    function replaceEngine(preview, newEngineIcon, nextPreview) {
      preview.engineIcon = newEngineIcon;
      input.nextPreview = nextPreview;
    }

    // Deactivate the engine if it's already active
    if (searchPreview1.engineIcon == engineIcon)
      replaceEngine(searchPreview1, null, 1);
    else if (searchPreview2.engineIcon == engineIcon)
      replaceEngine(searchPreview2, null, 2);
    // Activate the engine in the next preview slot
    else if (input.nextPreview == 1)
      replaceEngine(searchPreview1, engineIcon, 2);
    else
      replaceEngine(searchPreview2, engineIcon, 1);

    // Update search results with new/removed engines
    input.updatePreviews();
  };

  // Allow updating search results on command and toggle
  input.updatePreviews = function() {
    searchPreview1.search(input.value);
    searchPreview2.search(input.value);
  };

  // Handle the user searching for stuff
  input.addEventListener("command", function() {
    input.updatePreviews();
    sites.search(input.value);
  }, false);

  // Close the dashboard when hitting escape from an empty input box
  input.addEventListener("keydown", function(event) {
    if (event.keyCode == event.DOM_VK_ESCAPE && input.value == "")
      dashboard.open = false;
  }, false);

  // Describe the input box
  input.addEventListener("mouseover", function() {
    statusLine.set("text", "Search your top sites, open tabs, history, and the web");
  }, false);

  input.addEventListener("mouseout", function() {
    statusLine.set();
  }, false);

  // Create a list of search engines to toggle
  let engines = createNode("hbox");
  searchBox.appendChild(engines);

  engines.style.marginTop = "3px";
  engines.style.overflow = "hidden";

  // Add an icon for each search engine
  Services.search.getVisibleEngines().forEach(function(engine) {
    let engineIcon = createNode("box");
    engines.appendChild(engineIcon);

    // Style the search engine icon
    engineIcon.style.backgroundColor = "rgba(0, 0, 0, .3)";
    engineIcon.style.backgroundImage = "url(" + engine.iconURI.spec + ")";
    engineIcon.style.backgroundPosition = "center center";
    engineIcon.style.backgroundSize = "16px 16px";
    engineIcon.style.backgroundRepeat = "no-repeat";
    engineIcon.style.borderRadius = "5px";
    engineIcon.style.height = "22px";
    engineIcon.style.margin = "2px";
    engineIcon.style.width = "22px";

    Object.defineProperty(engineIcon, "active", {
      get: function() engineIcon.style.opacity != "0.5",
      set: function(val) {
        // Don't do work if we're already of that state
        val = !!val;
        if (val == engineIcon.active)
          return;

        // Toggle based on opacity
        engineIcon.style.opacity = engineIcon.active ? "0.5" : "1";
      }
    });
    engineIcon.active = false;

    engineIcon.getSearchUrl= function(query) {
      return engine.getSubmission(query).uri.spec;
    };

    // Inform the input to change engines
    engineIcon.addEventListener("click", function() {
      input.toggleEngine(engineIcon);
    }, false);

    // Indicate what clicking will do
    engineIcon.addEventListener("mouseover", function() {
      statusLine.set("toggle", engine.name);
    }, false);

    engineIcon.addEventListener("mouseout", function() {
      statusLine.set();
    }, false);
  });

  //// 4.2: History results

  //// 4.3: Top sites

  let sites = createNode("stack");
  sites.setAttribute("left", "800");
  sites.setAttribute("top", "450");
  dashboard.appendChild(sites);

  // Define the positions and size of the top sites
  const sizeScale = 60;
  const siteSizes = [
    [-2, -2, 2],
    [ 2, -2, 2],
    [-2,  2, 2],
    [ 2,  2, 2],
    [-5, -5, 1],
    [-3, -5, 1],
    [-1, -5, 1],
    [ 1, -5, 1],
    [ 3, -5, 1],
    [ 5, -5, 1],
    [-5, -3, 1],
    [ 5, -3, 1],
    [-5, -1, 1],
    [ 5, -1, 1],
    [-5,  1, 1],
    [ 5,  1, 1],
    [-5,  3, 1],
    [ 5,  3, 1],
    [-5,  5, 1],
    [-3,  5, 1],
    [-1,  5, 1],
    [ 1,  5, 1],
    [ 3,  5, 1],
    [ 5,  5, 1]
  ];

  // Place the top sites in-order at pre-defined locations/sizes
  topSites.forEach(function(pageInfo, index) {
    // Can't show the site if we don't know where to put it
    if (index >= siteSizes.length)
      return;

    let [leftBase, topBase, size] = siteSizes[index];

    let width = sizeScale * size * 2;
    let height = sizeScale * size * 3 / 4 * 2;
    let left = sizeScale * leftBase - width / 2;
    let top = sizeScale * topBase * 3 / 4 - height / 2;

    let siteBox = createNode("box");
    siteBox.setAttribute("left", left + "");
    siteBox.setAttribute("top", top + "");
    sites.appendChild(siteBox);

    siteBox.pageInfo = pageInfo;

    siteBox.style.backgroundColor = "rgba(244, 244, 244, .3)";
    siteBox.style.borderRadius = "10px";
    siteBox.style.opacity = ".5";
    siteBox.style.overflow = "hidden";
    siteBox.style.pointerEvents = "auto";

    let siteThumb = createNode("image");
    siteBox.appendChild(siteThumb);
    siteThumb.setAttribute("src", pageInfo.icon);
    siteThumb.style.height = height + "px";
    siteThumb.style.width = width + "px";

    siteBox.addEventListener("click", function() {
      // TODO swapDocShell stuff
      gBrowser.selectedBrowser.setAttribute("src", pageInfo.url);
      dashboard.open = false;
    }, false);

    // Indicate what clicking will do
    siteBox.addEventListener("mouseover", function() {
      statusLine.set("select", pageInfo.title);
      sites.highlight(siteBox);
      pagePreview.load(pageInfo.url);
    }, false);

    siteBox.addEventListener("mouseout", function() {
      statusLine.set();
      sites.highlight();
      pagePreview.reset();
    }, false);
  });

  // Highlight just one site box
  sites.highlight = function(targetBox) {
    // Not highlighting anything, so revert to the last query
    if (targetBox == null) {
      sites.search(sites.lastQuery);
      return;
    }

    // Fade out all the other boxes except the target made brighter
    Array.forEach(sites.childNodes, function(siteBox) {
      siteBox.style.opacity = siteBox == targetBox ? ".9" : ".1";
    });
  };

  // Allow clearing out any old state
  sites.reset = function() {
    sites.lastQuery = "";
  };
  sites.reset();

  // Search through the top sites to filter out non-matches
  sites.search = function(query) {
    // Remember what query to re-search when un-highlighting
    sites.lastQuery = query = query || "";

    // Find out which pages match the query
    let pageMatches = [];
    Array.forEach(sites.childNodes, function(siteBox) {
      // Just show the site if there's no query
      if (query == "") {
        siteBox.style.opacity = ".4";
        siteBox.style.pointerEvents = "auto";
      }
      // Emphasize the match and record it
      else if (queryMatchesPage(query, siteBox.pageInfo)) {
        siteBox.style.opacity = ".7";
        siteBox.style.pointerEvents = "auto";
        pageMatches.push(siteBox.pageInfo);
      }
      // Almost hide the site if not a match
      else {
        siteBox.style.opacity = ".1";
        siteBox.style.pointerEvents = "none";
      }
    });
    return pageMatches;
  };

  //// 4.4: Tabs

  //// 4.5: Browser controls

  //// 5: Status line

  let statusLine = createNode("label");
  statusLine.setAttribute("left", "0");
  statusLine.setAttribute("top", "0");
  masterStack.appendChild(statusLine);

  statusLine.collapsed = true;
  statusLine.style.backgroundColor = "rgba(224, 224, 224, .8)";
  statusLine.style.borderBottomRightRadius = "10px";
  statusLine.style.fontSize = "16px";
  statusLine.style.margin = "0";
  statusLine.style.padding = "0 3px 2px 28px";

  // Helper function to set the status text for a given action
  statusLine.set = function(action, text) {
    switch (action) {
      case "loadpage":
        text = "View " + text;
        break;

      case "loadref":
        text = "Jump to " + text;
        break;

      case "loadsite":
        text = "Go to " + text;
        break;

      case "reload":
        text = "Reload " + text;
        break;

      case "select":
        text = "Select " + text;
        break;

      case "switch":
        text = "Switch to " + text;
        break;

      // Just use the provided text
      case "text":
        break;

      case "toggle":
        text = "Toggle " + text;
        break;

      // Hide the status for no action/text
      default:
        statusLine.collapsed = true;
        return;
    }

    statusLine.collapsed = false;
    statusLine.value = text;
  };

  let (orig = window.XULBrowserWindow.setOverLink) {
    window.XULBrowserWindow.setOverLink = function(url, anchor) {
      // Clear the status if there's nothing to show
      if (url == "") {
        statusLine.set();
        return;
      }

      // Figure out what kind of action and text to show
      let action = "loadpage";
      let text = anchor && (anchor.textContent || anchor.alt).trim();
      let curURI = gBrowser.selectedBrowser.currentURI;
      let newURI = Services.io.newURI(url, null, null);

      // Figure out if we're switching sites
      if (curURI.scheme != newURI.scheme || hosty(curURI) != hosty(newURI)) {
        // Specially handle certain protocols
        switch (newURI.scheme) {
          case "data":
            action = "loadsite";
            text = "data: resource";
            break;

          case "https":
            action = "loadsite";
            text = "secure " + getHostText(newURI);
            break;

          case "javascript":
            action = "text";
            text = "Run script";
            break;

          default:
            action = "loadsite";
            text = getHostText(newURI);
            break;
        }
      }
      // Figure out if it's a reference change
      else if (curURI instanceof Ci.nsIURL && newURI instanceof Ci.nsIURL) {
        if (curURI.filePath == newURI.filePath && curURI.query == newURI.query)
          action = curURI.ref == newURI.ref ? "reload" : "loadref";
      }

      // Figure out a text for missing anchor or same domain pages
      if (text == null || text == "") {
        let path = newURI.path;

        // Find out the end of the path part before query or hash
        let end = path.indexOf("?");
        if (end == -1)
          end = path.indexOf("#");

        // Default to the end unless it's a trailing slash
        if (end == -1)
          end = path.length;
        if (path[end - 1] == "/")
          end--;

        // Get the last part after the last "/" of the path
        let lastPart = path.slice(path.lastIndexOf("/", end - 1) + 1, end);

        // Remove the file extension if necessary
        let extDot = lastPart.indexOf(".");
        if (extDot != -1)
          lastPart = lastPart.slice(0, extDot);

        // Upper-case each word of the last part
        text = upperFirst(lastPart.split(/[-_.+]+/));

        // Must be the root page path
        if (text == "")
          text = getHostText(newURI) + "'s home page";
      }

      statusLine.set(action, text);
    };
    unload(function() window.XULBrowserWindow.setOverLink = orig, window);
  }

  //// 6: Notification area

  let notifications = createNode("vbox");
  notifications.setAttribute("left", "0");
  notifications.setAttribute("top", "22");
  masterStack.appendChild(notifications);
  notifications.style.pointerEvents = "auto";

  // Provide a way to add a notification icon for a tab
  notifications.addTab = function(tab, callback) {
    // Check if we already have a notification for the tab
    let exists = Array.some(notifications.childNodes, function(icon) {
      if (icon.tab != tab)
        return false;

      // Add the callback to this tab's notification
      icon.callbacks.push(callback);
      return true;
    });
    if (exists)
      return;

    // Add an icon for the tab and track various properties
    let tabIcon = createNode("box");
    notifications.appendChild(tabIcon);
    let callbacks = tabIcon.callbacks = [];
    tabIcon.tab = tab;
    tabIcon.state = 0;

    // Use the favicon or a default page icon
    function updateIcon() {
      let src = getTabIcon(tab);
      if (src != updateIcon.lastSrc) {
        tabIcon.style.backgroundImage = "url(" + src + ")";
        updateIcon.lastSrc = src;
      }
    }
    updateIcon();

    // Style the tab notification icon
    tabIcon.style.backgroundColor = "rgba(0, 0, 0, .3)";
    tabIcon.style.backgroundPosition = "1px center";
    tabIcon.style.backgroundRepeat = "no-repeat";
    tabIcon.style.borderRadius = "0 100% 100% 0";
    tabIcon.style.height = "22px";
    tabIcon.style.width = "22px";

    // Add some callbacks to run when the tab is selected
    if (typeof callback == "function")
      callbacks.push(callback);
    callbacks.push(function() notifications.removeChild(tabIcon));

    // Run all the callbacks including removing the tab icon
    function runCallbacks() {
      callbacks.forEach(function(callback) callback());
    }

    // Run callbacks and remove notification and listeners on close or select
    callbacks.push(listen(window, tab, "TabClose", runCallbacks));
    callbacks.push(listen(window, tab, "TabSelect", runCallbacks));

    // Update the notification icon if the tab's icon changes
    callbacks.push(listen(window, tab, "TabAttrModified", updateIcon));

    // Switch to the tab when the notification icon is clicked
    tabIcon.addEventListener("click", function() {
      gBrowser.selectedTab = tab;
    }, false);

    // Indicate what clicking will do
    tabIcon.addEventListener("mouseover", function() {
      statusLine.set("switch", tab.getAttribute("label"));
    }, false);

    tabIcon.addEventListener("mouseout", function() {
      statusLine.set();
    }, false);
  };

  // Provide a way to pause/unpause
  Object.defineProperty(notifications, "paused", {
    get: function() notifications._paused,
    set: function(val) {
      // Don't do work if we're already of that state
      val = !!val;
      if (val == notifications.paused)
        return;
      notifications._paused = val;

      // Nothing more to do if we're unpausing
      if (!notifications.paused)
        return;

      // Make all notifications opaque
      Array.forEach(notifications.childNodes, function(notification) {
        notification.style.opacity = "1";
      });
    }
  });
  notifications._paused = false;

  // Keep updating notification icons and remove old ones
  let notifyInt = setInterval(function() {
    // Don't update the state when paused
    if (notifications.paused)
      return;

    // Figure out opaqueness of all notifications
    Array.forEach(notifications.childNodes, function(notification) {
      // Skip notifications that aren't visible anyway
      if (notification.collapsed)
        return;

      // Update until 600 iterations (60 seconds)
      let state = ++notification.state;
      // NB: Check for >= 600 as the notification can be unhidden
      if (state >= 600)
        notification.collapsed = true;
      else {
        // Icon opacity: abs(cos(x^4)) [positive, repeating, decreasing period]
        let opacity = Math.abs(Math.cos(Math.pow(state / 250, 4)));
        // Decrease opacity to 0 as state -> 600
        opacity = Math.pow(opacity * Math.pow(1 - state / 600, .3), .2);
        notification.style.opacity = opacity;
      }
    });
  }, 100);
  unload(function() clearInterval(notifyInt), window);

  // Pause updating opacity if the user might click
  notifications.addEventListener("mouseover", function() {
    notifications.paused = true;
  }, false);

  notifications.addEventListener("mouseout", function() {
    notifications.paused = false;
  }, false);

  // Watch for title changes in background tabs
  listen(window, gBrowser, "DOMTitleChanged", function(event) {
    // Only care about top-level title changes
    let content = event.target.defaultView;
    if (content != content.top)
      return;

    // No need to notify for fake tabs or the current tab
    let tab = gBrowser._getTabForContentWindow(content);
    if (tab == null || tab == gBrowser.selectedTab)
      return;

    // Don't notify or update the count if we already triggered
    const CHANGE_THRESHOLD = 2;
    let count = (tab.HDtitleChangedCount || 0) + 1;
    if (count > CHANGE_THRESHOLD)
      return;
    tab.HDtitleChangedCount = count;

    if (count == CHANGE_THRESHOLD)
      notifications.addTab(tab, function() tab.HDtitleChangedCount = 0);
  });

  // Don't switch to the tab on modal and show a notification instead
  listen(window, window, "DOMWillOpenModalDialog", function(event) {
    event.stopPropagation();

    // Only show notification for background tabs
    let tab = gBrowser._getTabForContentWindow(event.target.top);
    if (tab != gBrowser.selectedTab)
      notifications.addTab(tab);
  });

  // Watch for tabs being opened in the background
  listen(window, gBrowser.tabContainer, "TabOpen", function(event) {
    notifications.addTab(event.target);
  });

  // Clear out any state we set on external objects
  unload(function() {
    Array.forEach(gBrowser.tabs, function(tab) tab.HDtitleChangedCount = 0);
  });

  //// 7: Firefox icon

  let fxIcon = createNode("image");
  fxIcon.setAttribute("left", "0");
  fxIcon.setAttribute("top", "0");
  masterStack.appendChild(fxIcon);

  fxIcon.setAttribute("src", images["firefox22.png"]);
  fxIcon.style.height = "22px";
  fxIcon.style.opacity = ".3";
  fxIcon.style.pointerEvents = "auto";
  fxIcon.style.width = "22px";

  // Allow toggling the dashboard by clicking
  fxIcon.addEventListener("click", function() {
    dashboard.toggle();
  }, false);

  // Indicate what clicking will do
  fxIcon.addEventListener("mouseover", function() {
    fxIcon.style.opacity = "1";
    statusLine.set("toggle", "Home Dash");
  }, false);

  fxIcon.addEventListener("mouseout", function() {
    fxIcon.style.opacity = dashboard.open ? ".9" : ".3";
    statusLine.set();
  }, false);

  // Just go back to the default opacity when closing the dashboard
  fxIcon.reset = function() {
    fxIcon.style.opacity = ".3";
  };
}

/**
 * Handle the add-on being activated on install/enable
 */
function startup({id}) AddonManager.getAddonByID(id, function(addon) {
  // XXX Force a QI until bug 609139 is fixed
  Cu.import("resource://services-sync/util.js");
  Svc.History.QueryInterface(Ci.nsPIPlacesDatabase);

  // Get references to the packaged images
  ["defaultFavicon.png", "firefox22.png"].forEach(function(fileName) {
    images[fileName] = addon.getResourceURI("images/" + fileName).spec;
  });

  // Load various javascript includes for helper functions
  ["crunch", "helper", "utils"].forEach(function(fileName) {
    let fileURI = addon.getResourceURI("scripts/" + fileName + ".js");
    Services.scriptloader.loadSubScript(fileURI.spec, global);
  });

  // Crunch through some data to use later
  computeTopSites();

  // Change the main browser windows
  watchWindows(removeChrome);
  watchWindows(addDashboard);
})

/**
 * Handle the add-on being deactivated on uninstall/disable
 */
function shutdown(data, reason) {
  // Clean up with unloaders when we're deactivating
  if (reason != APP_SHUTDOWN)
    unload();
}

/**
 * Handle the add-on being installed
 */
function install(data, reason) {}

/**
 * Handle the add-on being uninstalled
 */
function uninstall(data, reason) {}
