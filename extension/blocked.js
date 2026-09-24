const q = new URLSearchParams(location.search);
document.getElementById("u").textContent = q.get("u") || "";
document.getElementById("b").textContent = q.get("b") || "—";
document.getElementById("r").textContent = q.get("r") || "—";
