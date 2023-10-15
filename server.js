import { WebSocketServer as Server } from "ws";
import { watchFile, watch, writeFile, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import * as pth from "path";
import express from "express";
import { MessageTypes, TreeType } from "./types.js";

const APP_PATH = "./app";
const COMP_PATH = "./components";
const INDEX_PATH = "index.html";
let server;
let projectTree = new Map();
let componentTree = new Map();
let clients = new Map();

async function* getFiles(dir, ignore_dirs, i = 0) {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const fullpath = pth.join(dir, dirent.name);
    if (dirent.isDirectory() && !ignore_dirs.includes(dirent.name)) {
      yield* getFiles(fullpath, ignore_dirs, i + 1);
    } else if (dirent.isFile()) {
      yield { fullpath, dirent };
    }
  }
}

function handleClientInit(id, client, data, _socket) {
  if (client.ctx.currentPath == null) {
    let { path: filePath } = data;
    if (filePath === "") {
      filePath = INDEX_PATH;
    }
    filePath = pth.join(APP_PATH, filePath);

    console.log("[client] at", filePath);

    if (projectTree.has(filePath)) {
      client.ctx.currentPath = projectTree.get(filePath);
    } else {
      console.error(`File '${pth}' Not found`);
    }
  }
}

function handleClientWrite(id, client, { content }, _socket) {
  if (client.ctx.currentPath) {
    const currentPath = client.ctx.currentPath;
    writeFileSync(currentPath.fullpath, content, function () {
      console.log("updating file", currentPath.fullpath);
      console.log(arguments);
    });
    sendPayload(id, _socket, MessageTypes.ACK, { message: "File saved!" });
  } else {
    sendPayload(id, _socket, MessageTypes.FAIL, { message: "File not found!" });
  }
}

function sendPayload(id, socket, type, data) {
  try {
    const dataStr = JSON.stringify({ id: id ? id : "0", type, data });
    socket.send(dataStr);
  } catch (err) {
    console.error("ERROR: sending payload", err);
  }
}

function parseMsg(msg) {
  const msgStr = msg.toString();
  try {
    const data = JSON.parse(msgStr);

    return data;
  } catch (err) {
    console.error("failed to parse client message", err);
  }

  return null;
}

function handleClientTree(id, client, data, _socket) {
  const { type } = data;
  switch (type) {
    case TreeType.COMP:
      sendPayload(id, _socket, MessageTypes.ACK, {
        tree: Array.from(componentTree.keys()),
      });
      break;
    case TreeType.PROJECT:
      sendPayload(id, _socket, MessageTypes.ACK, {
        tree: Array.from(projectTree.keys()),
      });
      break;
    default:
      sendPayload(id, _socket, MessageTypes.FAIL, {
        message: `Unknown tree type: ${type}`,
      });
      break;
  }
}

function handleMsg(client, { id, type, data }, _socket) {
  switch (type) {
    case MessageTypes.INIT:
      return handleClientInit(id, client, data, _socket);
    case MessageTypes.WRITE:
      return handleClientWrite(id, client, data, _socket);
    case MessageTypes.TREE:
      return handleClientTree(id, client, data, _socket);
    default:
      console.error("Unhandled message Type", type);
      break;
  }
}

function attachServer() {
  if (server) {
    server.close();
  }

  //start ws server
  server = new Server({
    port: 8090,
  });
  server.on("connection", function (socket) {
    //attach client to file context
    console.log("new client connected");
    clients.set(socket, {
      socket,
      ctx: {
        currentPath: null,
      },
    });

    //TODO: save previous editing routes

    socket.on("message", function (msg) {
      const client = clients.get(socket);
      const req = parseMsg(msg);
      handleMsg(client, req, socket);
    });

    socket.on("close", function () {
      clients.delete(socket);
    });
  });
}

function updateClients() {
  for (const [socket, client] of clients.entries()) {
    const ctx = client.ctx;
    if (ctx.currentPathr) {
      const hasUpdates = checkPathUpdates(ctx.currentPath);
      ///TODO: echo updates to client
    }
  }
}

function requestClientReload(path) {
  console.log("reloading", path);
  for (const [socket, client] of clients.entries()) {
    sendPayload(String(MessageTypes.RELOAD), socket, MessageTypes.RELOAD, {
      path,
    });
  }
}

async function updateTree(tree, cpath) {
  const newFiles = [];
  for await (const fileInfo of getFiles(cpath, [])) {
    if (!tree.has(fileInfo.fillpath)) {
      newFiles.push(fileInfo.fullpath);
    }
    //update or set new file data
    tree.set(fileInfo.fullpath, fileInfo);
  }
  return newFiles;
}

async function startServer() {
  const projectPaths = await updateTree(projectTree, APP_PATH);
  const componentsPaths = await updateTree(componentTree, COMP_PATH);

  console.log("project files", projectPaths);
  console.log("component files", componentsPaths);
  console.log("startig Server..");
  attachServer();
  // setInterval(updateClients, 1000);

  const app = express();
  app.use(express.static(APP_PATH));
  const internalProviders = [
    { route: "editor.js", file: "./editor_client.js" },
    { route: "types.js", file: "./types.js" },
    { route: "nilla.js", file: "./nilla.js" },
    { route: "nilla_generators.js", file: "./nilla_generators.js" },
  ];

  //serve main scripts
  for (const { route, file } of internalProviders) {
    console.log("serving internals: ", route, file);
    app.get(`/${route}`, (_req, res) => {
      res.sendFile(pth.resolve(file));
    });
  }

  //server components
  {
    const componentsPath = pth.join(COMP_PATH, ":fileName");
    app.get(`/${componentsPath}`, (req, res) => {
      const { fileName } = req.params;
      const cfile = pth.join(COMP_PATH, fileName);
      if (componentTree.has(cfile)) {
        res.sendFile(pth.resolve(cfile));
      } else
        [
          res.status(400).send({
            message: `Component ${fileName} Not found!`,
          }),
        ];
    });
  }

  let lattestChanges = new Map();

  watch("./", { recursive: false, persistent: true }, function (type, file) {
    const now = new Date();
    if (lattestChanges.has(file)) {
      const lastChanged = lattestChanges.get(file);
      const delta = now - lastChanged;
      if (delta <= 100) {
        return;
      }
    }

    console.log("changed file: ", file);
    lattestChanges.set(file, now);
    switch (file) {
      case "editor_client.js":
      case "nilla.js":
      case "nilla_generators.js":
        requestClientReload(file);
        break;
    }
  });

  watch(APP_PATH, function (_type, file) {
    const cfile = pth.join(COMP_PATH, file);
    const now = new Date();
    if (!projectTree.has(cfile)) {
      updateTree(projectTree, COMP_PATH);
      console.log("updated project tree:", projectTree);
    }

    if (lattestChanges.has(cfile)) {
      const lastChanged = lattestChanges.get(cfile);
      const delta = now - lastChanged;
      if (delta <= 100) return;
    }
    lattestChanges.set(cfile, now);
    //set only to local name
    requestClientReload(file);
  });

  watch(COMP_PATH, function (_type, file) {
    const cfile = pth.join(COMP_PATH, file);
    if (!componentTree.has(cfile)) {
      updateTree(componentTree, COMP_PATH);
      console.log("updated component tree:", componentTree);
    }

    const now = new Date();
    if (lattestChanges.has(cfile)) {
      const lastChanged = lattestChanges.get(cfile);
      const delta = now - lastChanged;
      if (delta <= 100) return;
    }
    lattestChanges.set(cfile, now);
    requestClientReload(cfile);
  });

  app.listen(8080);
}

startServer().then(() => {});
