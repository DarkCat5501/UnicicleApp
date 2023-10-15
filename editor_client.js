import { MessageTypes, TreeType } from "./types.js";
import { include, toElements, toElement } from "./nilla.js";
// import gen from "./nilla_generators.js";

class EditorClient {
  constructor() {
    this.sk = undefined;
    this.skipReload = new Set();
    this._responseCallbacks = new Map();
    this._handlers = {
      start: {
        events: [],
        called: false,
      },
      end: {
        events: [], //
        called: false,
      },
    };
    this.attachSocketClient();
  }

  _generateId() {
    const date = Number(new Date());
    const number = Math.random();
    return (date + number).toString(16).replace(/[.]/, "");
  }

  parseMsg(msg) {
    const msgStr = msg.toString();
    try {
      const data = JSON.parse(msgStr);

      return data;
    } catch (err) {
      console.error("[failed to parse server message]", err);
    }

    return null;
  }

  /**
   * sends a payload to with websocket
   * @param {MessageTypes} type
   * @param {Record<string,any>} data
   **/
  sendPayload(type, data, id = "0") {
    if (this.sk.readyState) {
      try {
        const dataStr = JSON.stringify({ id, type, data });
        this.sk.send(dataStr);
        return id;
      } catch (err) {
        console.error("ERROR: sending payload:", err);
      }
    }
    return null;
  }

  async sendRequest(type, data) {
    const id = this._generateId();
    return new Promise((resolve, reject) => {
      this._responseCallbacks.set(id, (_id, _type, _data) => {
        switch (_type) {
          case MessageTypes.ACK:
            return resolve(_data);
          default:
            return reject(_data);
        }
      });
      this.sendPayload(type, data, id);
    });
  }

  _callEvents(type) {
    // console.log("calling events", type);
    if (!(type in this._handlers)) {
      throw new Error("Unknown event type called");
    }
    this._handlers[type].called = true;
    for (const { fn, called } of this._handlers[type].events) {
      if (!called) fn();
    }

    //clear event pipe for type
    this._handlers[type].length = 0;
  }

  appendEvent(type, callback) {
    if (!(type in this._handlers)) {
      throw new Error("Handler type nort defined");
    }
    if (this._handlers[type].called) {
      console.log("force call");
      this._callEvents(type); //force run other callbacks
      callback(); //force run callback
    } else {
      this._handlers[type].events.push({ fn: callback, called: false });
    }
  }

  sendCurrentLocation() {
    const loc = {
      path: location.pathname.replace("/", ""),
    };

    this.sendPayload(MessageTypes.INIT, loc);
  }

  handleOpen(_) {
    console.log("[SERVER CONNECTED]");
    this.sendCurrentLocation();
    this._callEvents("start");
  }

  _handleResponses(id, type, data) {
    if (this._responseCallbacks.has(id)) {
      const callback = this._responseCallbacks.get(id);
      if (callback) {
        return callback(id, type, data);
      }
    }
    throw new Error(`Unhandled response id: ${id}`);
  }

  handleMessages(event) {
    const { data } = event;
    const messageData = this.parseMsg(data);
    const { id, type, data: dt } = messageData;

    switch (type) {
      case MessageTypes.ACK:
      case MessageTypes.FAIL:
        this._handleResponses(id, type, dt);
        break;
      case MessageTypes.RELOAD:
        console.log("[changed]", dt.path);
        if (!this.skipReload.has(dt.path)) {
          //TODO: implement lazy reloading
          location.reload();
        } else {
          this.skipReload.delete(dt.path);
        }
        break;
      default:
        console.error("[Unhandle server message]");
    }
  }
  handleDisconnection(event) {
    if (event.wasClean) {
      console.log("[server disconected]");
      this._callEvents("end");
    } else {
      console.log("[server disconected] reconnecting ...");
      setTimeout(this.attachSocketClient, 500, 1);
    }
  }
  handleError(event) {}

  attachSocketClient() {
    if (this.sk) {
      this.sk.close();
    }

    //create a new websocket and connect it
    try {
      this.sk = new WebSocket("ws://localhost:8090");
      this.sk.onopen = (...args) => this.handleOpen(...args);
      this.sk.onmessage = (...args) => this.handleMessages(...args);
      this.sk.onclose = (...args) => this.handleDisconnection(...args);
      this.sk.onerror = (...args) => this.handleError(...args);
    } catch (err) {
      console.error("[error trying to connect to server]");
    }
  }

  async listTree(treeType) {
    const { tree } = await this.sendRequest(MessageTypes.TREE, {
      type: TreeType.COMP,
    });

    return tree;
  }
  renderDocType() {
    return {
      ident: 0,
      data: `<!DOCTYPE ${document.doctype.name}>`,
    };
  }
  rendeNodeAttributes(node) {
    const { attributes } = node;
    // console.log("attributes", attributes);
    const output = [];
    for (const attr of attributes) {
      output.push(`${attr.name}="${attr.value.replaceAll('"', '\\"')}"`);
      // console.log(attr.name, attr.value);
    }

    return output.join(" ");
  }

  canSkipNode(node) {
    const attributes = "attributes" in node ? node.attributes : {};
    if (attributes["editor-skip"]) {
      console.log("skipping", node);
      return true;
    }
    return false;
  }

  renderNode(node, ident) {
    const { nodeType } = node;

    if (this.canSkipNode(node)) return null;

    // console.log(node, nodeType);
    switch (nodeType) {
      case 3:
        //TODO: clear text with only whitespaces
        return { tag: `${node.textContent.trim()}` };
      case 8:
        return { tag: `<!--${node.textContent}-->` };
      default:
        break;
    }

    const { tagName } = node;
    const tgName = tagName.toLowerCase();
    const attribs = this.rendeNodeAttributes(node, ident);
    const attrs = attribs ? ` ${attribs}` : "";

    switch (tagName) {
      case "META":
      case "STYLE":
        return { tag: `<${tgName}${attrs}>` };
      case "TITLE":
      case "SCRIPT":
      case "DIV":
        return {
          tagStart: `<${tgName}${attrs}>`,
          content: this.renderElement(node.childNodes, ident + 1),
          tagEnd: `</${tgName}>`,
        };
      default:
        if (node.childNodes.length > 0) {
          return {
            tagStart: `<${tgName}${attrs}>`,
            content: this.renderElement(node.childNodes, ident + 1),
            tagEnd: `</${tgName}>`,
          };
        }
        return {
          tag: `<${tgName}${attrs}/>`,
        };
    }
  }
  compressNodes(start, end, content, ident) {
    switch (content.length) {
      case 0:
        if (start.length + end.length < 80) {
          return [{ ident, data: `${start}${end}` }];
        }
        break;
      case 1:
        if (
          !content[0].noCompress &&
          start.length + content[0].data.length + end.length < 80
        ) {
          return [
            {
              ident: content[0].ident,
              data: `${start}${content[0].data}${end}`,
              noCompress: true,
            },
          ];
        }
        break;
    }

    const output = [];
    output.push({ ident, data: start });
    for (const ctent of content) {
      output.push(ctent);
    }
    output.push({ ident, data: end });
    return output;
  }
  renderElement(elements, ident = 0) {
    const output = [];
    for (const node of elements) {
      const tag = this.renderNode(node, ident);
      if (!tag) continue;
      if ("tag" in tag && tag.tag) {
        output.push({ ident, data: tag.tag });
      } else if ("tagStart" in tag && "tagEnd" in tag) {
        const { tagStart, tagEnd, content } = tag;
        output.push(...this.compressNodes(tagStart, tagEnd, content, ident));
      }
    }
    return output;
  }
  clearEditorElements(element) {
    for (const node of element.childNodes) {
      if (node.attributes) {
        const data_element = node.attributes["data-element"];
        if (data_element && data_element.value === "false") {
          element.removeChild(node);
          continue;
        }
      }

      if (node.childNodes.length) {
        clearEditorElements(node);
      }
    }
  }
  documentContent() {
    const lines = [this.renderDocType()];
    lines.push(...this.renderElement([document.documentElement]));
    let file = "";
    for (const line of lines) {
      const identText = Array.from({ length: line.ident }, (_) => " ").join("");
      file += `${identText}${line.data}\n`;
    }

    return file;
  }

  updateFile() {
    const currentFile = location.pathname.replace("/", "");
    const content = this.documentContent();
    console.log(content);
    this.skipReload.add(currentFile);
    this.sendPayload(MessageTypes.WRITE, { content: content });
  }
}

function stripScripts(nodes) {
  const scripts = [];
  for (const node of nodes.childNodes) {
    const { nodeType } = node;
    if (nodeType === 1 && node.tagName === "SCRIPT") {
      nodes.removeChild(node);
      scripts.push(node);
    }
  }
  return scripts;
}

function cloneAttributes(nodeA, nodeB) {
  for (const attr of nodeA.attributes) {
    nodeB.setAttribute(attr.name, attr.value);
  }
}

function loadScripts(scripts) {
  for (const script of scripts) {
    const newScript = document.createElement("script");
    cloneAttributes(script, newScript);
    newScript.innerText = script.innerText;
    document.head.appendChild(newScript);
  }
}

window.clientEditor = new EditorClient();

async function mainUI() {
  const app = document.getElementById("app");
  const fwindow = await include("components/editor.html");
  const floaWindow = toElements(fwindow);
  const scripts = stripScripts(floaWindow);
  app.insert(floaWindow);
  // console.log("loading scripts", scripts);
  loadScripts(scripts);
}

window.onload = function () {
  mainUI().then(() => {});
};
