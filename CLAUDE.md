# CLAUDE.md — Startup_Sem40

Repo bài tập khởi nghiệp môn **ETR601 · SEM40HN**. Là một site tĩnh (HTML/CSS/JS thuần, không framework, không build step) deploy lên **Cloudflare Pages**, domain `startup.sem40hn.asia`.

## ⚠️ Deploy là THỦ CÔNG — push GitHub KHÔNG tự deploy

Đây là điểm dễ sai nhất. `git push` chỉ lưu code lên GitHub; **trang live không đổi** cho đến khi chạy lệnh deploy:

```bash
cd website && npx wrangler pages deploy public --project-name omnistay-ai --branch main --commit-dirty=true
```

Sau khi sửa bất kỳ file nào trong `website/public/`, quy trình đầy đủ là: **edit → commit + push → deploy wrangler → verify**.

Verify bằng curl + cache-bust (không tin cache trình duyệt):
```bash
curl -s "https://startup.sem40hn.asia/<path>?cb=$(date +%s%N)" | grep -c "<chuỗi đặc trưng>"
```
Deploy production cần user xác nhận (bị sandbox classifier chặn).

## Cấu trúc

- `website/public/` — output dir của Cloudflare Pages (cấu hình ở `website/wrangler.toml`, project `omnistay-ai`). Mỗi trang là 1 file HTML self-contained:
  - `index.html` (`/`) — OmniStay AI landing
  - `taxflow.html` (`/taxflow`) — TaxFlow AI (ý tưởng từng được chọn)
  - `ideas.html` (`/ideas`) — 10 ý tưởng + voting
  - `eldercare.html` (`/eldercare`) — landing ElderCare VN
  - `eldercare-plan.html` (`/eldercare-plan`) — business plan nhiều tab (#market, #experience, #founders, Five Forces, Canvas…)
  - `eldercare-app.html` (`/eldercare-app`) — **app demo clickable** (phone-frame). Xem mục dưới.
  - `eldercare-deck.{pptx,pdf}`, `eldercare-class-deck.{pptx,pdf}`, `eldercare-financial-model.xlsx` — tài liệu tĩnh
- `website/functions/api/votes.js` — Cloudflare Pages Function cho voting (KV binding `STARTUP_VOTES`)
- `deck-build/` — build script tạo deck (`build.js`, `build-class.js`), gitignored node_modules. Không phải runtime của site.
- `Docs/` — syllabus & tài liệu môn học

## eldercare-app.html (app demo)

Vanilla JS, **data-driven theo persona**: object `PROFILES` với 2 hồ sơ `hoa` (Bà Hoa, nhẹ) và `tam` (Ông Tâm, nặng/sa sút trí tuệ). Đổi persona → toàn bộ vitals/đội chăm/cảnh báo/gói/người-chăm-gần render lại theo data.

- 5 màn chính (bottom-nav): `home`, `care`, `visit`, `fin`, `parent` — mỗi màn render từ `renderX()`, inner-HTML vào `#screen-X`.
- Overlay (z-index 60): video call, onboarding triage, pharmacy/xác thực thuốc, **nearby radar/map**, fall/emergency. Bottom-sheet ở z-index 66 (phải cao hơn overlay để hiện đè lên).
- **Tính năng "Quét quanh đây"** (`openNearby`): radar quét động + bản đồ thật (Leaflet/OpenStreetMap, load qua CDN unpkg) + bộ lọc loại người chăm + đổi địa bàn (7 quận Hà Nội trong `AREAS`). Dữ liệu người chăm ở `PROFILES[x].nearby` (có `type`, `deg`, `dist`, `km`…), toạ độ nhà ở `PROFILES[x].home`.

Quy ước: text tiếng Việt; địa lý khởi đầu là **Hà Nội**; mọi số liệu/người là dữ liệu minh họa demo (badge "Dữ liệu minh họa").

## Preview local

Server `website-preview` trong `.claude/launch.json` (dùng `serve website/public`, KHÔNG dùng flag `-s` vì nó rewrite mọi route về index.html). Dùng preview tools để verify thay vì hỏi user kiểm tra tay.

## Git

Mặc định commit message tiếng Việt, mô tả tính năng. Luôn commit + push lên `main` trước khi bắt đầu phiên build mới.
