// Load navigation bar
document.addEventListener('DOMContentLoaded', () => {
    fetch('/navigation.html')
      .then(response => response.text())
      .then(data => {
        document.getElementById('navigation').innerHTML = data;
      });
  });