Array.from(document.querySelectorAll("input[data-mask]")).forEach(applyMask);

function isDigit(v) {
  return /\d/.test(v);
}

function showMask(input) {
  const mask = input.getAttribute("data-mask");
  let value = "";

  let m = 0;
  for (let i = 0; i < input.value.length; i++) {
    const mk = mask[m];
    const va = input.value[i];
    switch (mk) {
      case "#":
        if (isDigit(va)) {
          value += va;
          m++;
        }
      default:
        if (va === mk) {
          value += va;
          m++;
        } else if (".-".includes(mk)) {
          i--;
          m++;
          value += mk;
        }
        break;
    }
  }

  input.value = value;
  input.tmp_value = value;

  if (value.length < mask.length) {
    for (let i = value.length; i < mask.length; i++) {
      const mk = mask[i];
      switch (mk) {
        case "#":
          input.value += " ";
          break;
        default:
          input.value += mk;
          break;
      }
    }
  }

  const cursor = Math.min(input.selectionStart, m);
  input.setSelectionRange(cursor, cursor);
}

function maskedLength(value, mask) {
  let m = 0;
  for (let i = 0; i < value.length; i++) {
    const mk = mask[m];
    const va = value[i];
    switch (mk) {
      case "#":
        if (isDigit(va)) m++;
        break;
      default:
        if (va === mk) m++;
        else if (".-".includes(mk)) {
          i--;
          m++;
        }
        break;
    }
  }
  return m;
}

function handleMaskInput(input, e) {
  const cursor = input.selectionStart;
  const mask = input.getAttribute("data-mask");
  const maskLen = maskedLength(input.value, mask);

  if (e.key == "Backspace") {
    if (cursor >= maskLen) {
      const isSharp = mask[maskLen - 2] === "#" && mask[maskLen - 1] !== "#";
      input.value = input.value.slice(0, maskLen - (isSharp ? 2 : 1));
    } else {
      const value =
        input.value.slice(0, cursor - 1) + input.value.slice(cursor);
      input.value = value;
    }
    showMask(input);
    e.preventDefault();
  } else if (e.key == "Delete") {
    e.preventDefault();
  }

  //TODO: resolver
}

function applyMask(input) {
  showMask(input);
  input.addEventListener("focus", () => input.select());
  input.addEventListener("keydown", (e) => handleMaskInput(input, e));
  input.addEventListener("input", () => showMask(input));
}

var map = L.map("map").setView([-23.5441, -46.64], 15);

async function loadGeoJson(path, options) {
  const data = await fetch(path);
  const geoJson = await data.json();
  L.geoJson(geoJson, options).addTo(map);
}

function setStyle(feature) {
  console.log(feature);
  switch (feature.properties.COUNTRY) {
    case "Brazil":
      return { color: "#ff9900" };
    case "United States":
      return { color: "#ff00ff" };
    case "Colombia":
      return { color: "#00ff00" };
    case "México":
      return { color: "#ffff00" };
    default:
      console.log(feature.properties.COUNTRY);
  }
  return { color: "#adadad" };
}

// loadGeoJson("./static/level_0/BRA.json", { style: setStyle });
// loadGeoJson("./static/level_0/USA.json", { style: setStyle });
// loadGeoJson("./static/level_0/COL.json", { style: setStyle });
// loadGeoJson("./static/level_0/MEX.json", { style: setStyle });

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  style: "",
  maxZoom: 15,
}).addTo(map);

function getLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(updateCurrentPosition);
  }
}

function updateCurrentPosition(position) {
  map.setView([position.coords.latitude, position.coords.longitude], 15);
}

getLocation();
