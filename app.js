(async () => {
  try {
    const files = [
      './app.parts/01.txt',
      './app.parts/02.txt',
      './app.parts/03.txt',
      './app.parts/04.txt',
      './app.parts/05.txt',
      './app.parts/06.txt',
      './app.parts/07.txt',
      './app.parts/08.txt',
      './app.parts/09.txt',
      './app.parts/10.txt',
      './app.parts/11.txt',
      './app.parts/12.txt',
      './app.parts/13.txt',
      './app.parts/14.txt',
      './app.parts/15.txt'
    ];
    const parts = await Promise.all(files.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`載入程式失敗：${url} (${response.status})`);
      return response.text();
    }));
    (0, eval)(parts.join('') + "\n//# sourceURL=voicekeys-app.js");
  } catch (error) {
    console.error(error);
    const box = document.getElementById('statusText');
    if (box) box.textContent = '網站程式載入失敗，請重新整理頁面。';
  }
})();