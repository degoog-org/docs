document.addEventListener("DOMContentLoaded", function () {
  var page = window.location.pathname.split("/").pop() || "index.html";
  if (!page || page === "") page = "index.html";
  document.querySelectorAll(".degoog-docs-nav-item").forEach(function (link) {
    if (link.getAttribute("href") === page) {
      link.classList.add("degoog-docs-nav-active");
    }
  });

  var burger = document.getElementById("degoog-docs-burger");
  var sidebar = document.querySelector(".degoog-docs-sidebar");
  var backdrop = document.getElementById("degoog-docs-backdrop");

  if (burger && sidebar && backdrop) {
    burger.addEventListener("click", function () {
      var isOpen = sidebar.classList.toggle("degoog-docs-sidebar-open");
      backdrop.style.display = isOpen ? "block" : "none";
    });

    backdrop.addEventListener("click", function () {
      sidebar.classList.remove("degoog-docs-sidebar-open");
      backdrop.style.display = "none";
    });
  }

  var themeBtn = document.getElementById("doc-theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("ade:theme", next);
      } catch (e) {}
    });
  }
});
