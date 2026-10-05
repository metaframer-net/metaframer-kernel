# Devir notu — MetaFramer Kernel (2026-10-05)

> **Bu belge kanonik değildir.** Yalnızca yol gösteren bir özettir (navigational projection).
> Burada yazan bir şey, adı geçen kanonik sahibin söylediğiyle çelişirse **kanonik sahip kazanır**;
> bu dosya o sahibe göre düzeltilir, tersi asla yapılmaz. Bu dosya hiçbir bayrağı değiştirmez,
> hiçbir yetki vermez, hiçbir sürüm veya yayın kararı taşımaz.

## 1. Depo nerede

| Ne | Değer |
|---|---|
| Yerel ana depo | `/Users/karaca/DEV/mimari/metaframer-kernel` |
| origin | `git@github.com:metaframer-net/metaframer-kernel.git` |
| Web | https://github.com/metaframer-net/metaframer-kernel |
| Varsayılan dal | `main` |
| Bu belgenin son adresi | https://github.com/metaframer-net/metaframer-kernel/blob/main/devir.md |

## 2. Bugünkü gerçek durum

Kanonik sahip: [`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json)
(insan okuması için [ROADMAP.md](ROADMAP.md); yetki kaydı için [README.md](README.md) `## Current status`).

- İlerleme: **23/25 tamamlandı, P24/25 aktif.** Payda sabit 25 pakettir.
- P24 (üç bağımsız dış tüketici ekip): sayılan bağımsız ekip **0/3**. Hazırlık alt paketleri
  (P24A–P24E2) birleşti, ama hiçbir gerçek ekip henüz koşmadı; sayaç 0'dır.
- P25 (promotion gate'leri): **henüz tanımlanmadı ve hiç çalıştırılmadı.**
- `runtimeImplementationStarted=true` — tek doğru olan bayrak budur ve bir hazırlık iddiası değildir.
- Daha güçlü her bayrak **false**:
  `kernelReady=false`, `sdkReady=false`, `appBuildable=false`, `releaseAllowed=false`,
  `deployAllowed=false`, `productionAllowed=false`, `gapClosed=false`,
  `oneGoldenSliceReady=false`, `runnableProduct=false`.
- **Somut ürün iddiası:** barındırılan (hosted) uçtan uca hiçbir SaaS kullanıcı yolculuğu
  çalışmıyor. Örnek: bir CRM'de "müşteri formunu gönder → kaydet → reddedilirse düzelt → tekrar
  dene" akışını gerçek bir kullanıcı bugün bir adrese girip yapamaz; ekran, kalıcı ortam ve
  erişilebilir adres yoktur. Var olan şey test altında kanıtlanmış parçalardır.

## 3. P01–P23 ne teslim etti (gruplu, işaretçi)

Ayrıntı ve kanıt (PR, CI koşusu) için tek kaynak:
[`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json)
`currentTruth.implementedPieces`. Burada yeni bir yetenek iddiası yoktur.

| Aile | Paketler | Kısaca |
|---|---|---|
| F0 | P01 | Güncel gerçek + yol haritası dosyası, testle doğrulanmış. |
| F1 | P02–P06 | Kernel sözleşmeleri: Action Contract, PDP istek/karar, veri olarak politika, UoW/CommitReceipt, kalıcılık sahipliği koruması. |
| F2 | P07–P09 | Genel SDK üreticisi, sürümlü dağıtım, temiz tüketici uyumluluğu. |
| F3 | P10–P14 | app-core, uygulamanın kendi müşteri şeması/adaptörü, veri geçişi ve geri alma, Kernel temizliği. |
| F4 | P15–P16 | Müşteri modülü tipli API'si ve ayrı Surface/UI projeksiyonu (süreç içi; DOM yok). |
| F5 | P17–P18 | Kurulabilir ASGI host paketi, tek geçişli outbox relay. |
| F6 | P19–P23 | Gözlenebilirlik/SLO ölçümü, performans özeti, güvenlik (P21A–G), kendini silen geçici ortamda deploy kanıtı (P22), elle yapılan yedek/geri yükleme, yedek sunucuya geçiş ve şema geri alma tatbikatları (P23). |

S1 veritabanı tabanı (PostgreSQL/RLS/transaction/outbox/audit) ve dış etkinleştirme etiketi için
[README.md](README.md) `## Implemented substrate (S1)`.

## 4. Kalan iş

1. **P24 — gerçek bağımsız ekipler.** Üç gerçek, bağımsız ekip yükü kendi başına koşmalı ve
   `ownerHelpCount=0` olmalı. Ajan, çalışan, prob veya worker asla sayılmaz. Kurallar:
   [docs/external-consumer-intake.md](docs/external-consumer-intake.md); kayıt şekli:
   [`planning/external-consumer-run-record.json`](planning/external-consumer-run-record.json),
   denetleyici: [`tools/check-external-consumer-run-record.mjs`](tools/check-external-consumer-run-record.mjs).
2. **P25 — promotion gate seti.** Tanımlanmalı ve çalıştırılmalı. Ancak bundan sonra `gapClosed`
   ilk kez değerlendirilebilir.
3. **Adıyla açık kalan operasyonel boşluklar** (tam liste: `currentTruth.notImplementedPieces`):
   - Gerçek trafik için canlı giriş noktası/host yok; kalıcı ağ dinleyicisi yok.
   - Relay etrafında üretim zamanlayıcısı, yeniden deneme politikası ve DLQ yok.
   - Kalibre edilmiş performans eşiği/SLA, sürekli yük ve maliyet kanıtı yok.
   - SLO olayları için exporter, pano ve alarm taşıyıcısı yok.
   - Staging ortamı yok; registry'ye itme yok; orkestrasyon, ingress, TLS, DNS, secret store yok.
   - Yedek takvimi, saklama, PITR, RPO/RTO yok; otomatik failover yok; yüksek erişilebilirlik yok.
   - Şema geri alma kesintili ve karar geçmişini siliyor; bakım hatası anonim bir 502.
   - Gerçek kimlik doğrulama/oturum yok; audit isteğe bağlı ve varsayılan kapalı.
   - Gizli bilgi taraması yalnızca güncel ağacı tarar, Git geçmişini taramaz ve zorunlu kontrol değildir.
   - DAST/penetrasyon testi yok.

## 5. Yönetim sırası ve geliştirme yöntemi

Öncelik sırası (yukarıdaki kazanır):

1. Makine sahibinin global yönetilen yönergeleri (depo dışında; en yüksek öncelik).
2. [AGENTS.md](AGENTS.md) — depoya özgü kurallar.
3. [RULES.md](RULES.md) — kanonik kaynaklara işaret eden kısa dizin.
4. [`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json) — yol haritasının makinece okunan tek sahibi.
5. [ROADMAP.md](ROADMAP.md) — onun insan okuması projeksiyonu.
6. [`planning/ultra-fast-v1-policy.json`](planning/ultra-fast-v1-policy.json) — ek hızlı paket katmanı (Actionplan bütçesinin yerine geçmez).

Çalışma biçimi:

- **Yazar yalnızca Claude'dur.** Codex Desktop MASTER düzenleyici, kapsam/geri alma sahibi ve Git
  yürütücüsüdür; Kernel'e **sıfır bayt** yazar (test ve fixture dahil).
- Pane affinitesi tam worktree eşleşmesidir: Pane'in worktree yolu paketin worktree yoluyla
  birebir aynı değilse yazma reddedilir.
- Her pakette tek yazar; yazan, kendi paketini incelemez; bağımsız Claude incelemesi ayrı ve salt okunurdur.
- Test gerekçeliyse 3–8 hedefli senaryo ve en fazla 2 test dosyası.
- 20. dakikada kontrol noktası.
- En fazla 3 yazar şeridi, yalnızca Guardian izin verdiğinde.
- Paket başına tam olarak 2 tam QA koşusu (bir yerel, bir CI); geniş test takımları tekrar tekrar koşulmaz.
- Pane paneli temizliği yalnızca olaya bağlıdır; zamanlayıcı, cron, daemon veya kanca yoktur.
- Sürüm ve changelog kuralı: [`versioning-policy.json`](versioning-policy.json) kanoniktir;
  güncel değer `0.1.0-alpha.1`, tavan `0.1.0`; ajan sürüm yazamaz, etiket/yayın oluşturamaz.

## 6. Belge ve talimat haritası

| Dosya | Ne için |
|---|---|
| [AGENTS.md](AGENTS.md) | Depo kuralları, yazar kilidi, yetki, sürüm kapısı. |
| [RULES.md](RULES.md) | Kanonik kaynak dizini. |
| [ROADMAP.md](ROADMAP.md) | 25 paketlik plan, DAG, ilerleme. |
| [README.md](README.md) | Yetki kaydı, uygulanan parçalar, yerel doğrulama. |
| [CHANGELOG.md](CHANGELOG.md) | Yalnızca `## [Unreleased]`. |
| [LICENSE](LICENSE) | AGPL-3.0-only (üretilen SDK modülleri için MIT izni P24E2 ile). |
| [versioning-policy.json](versioning-policy.json) / [docs/versioning-policy.md](docs/versioning-policy.md) | Sürüm treni ve tavan. |
| [`planning/roadmap-v1-current-truth.json`](planning/roadmap-v1-current-truth.json) | Güncel gerçek, tek sahip. |
| [`planning/ultra-fast-v1-policy.json`](planning/ultra-fast-v1-policy.json) | Hızlı paket eşikleri. |
| [`planning/kernel-runtime-pilot-consumer-sync.json`](planning/kernel-runtime-pilot-consumer-sync.json) | Güncel yetkiye bağlanma katmanı. |
| [docs/external-consumer-intake.md](docs/external-consumer-intake.md) | P24 dış ekip protokolü. |
| [docs/resume-runbook.md](docs/resume-runbook.md) | Planlama dönemi devam kılavuzu (tarihsel `PLANNING_ONLY` başlığı taşır). |
| [docs/repository-boundary.md](docs/repository-boundary.md) | Depo sınırı kararı (tarihsel anlık görüntü). |
| [docs/kernel-ai-development-readiness.md](docs/kernel-ai-development-readiness.md) | Yapay zekâ ile geliştirme hazırlığı kaydı. |
| [`.claude/skills/ultra-fast-development/SKILL.md`](.claude/skills/ultra-fast-development/SKILL.md) | Hızlı paket becerisi (politikanın projeksiyonu). |
| [`.claude/skills/metaframer-token-economy/SKILL.md`](.claude/skills/metaframer-token-economy/SKILL.md) / [token-economy-policy.json](token-economy-policy.json) | Token ekonomisi ve model yönlendirme. |
| [`.claude/agents/`](.claude/agents/) | Test yazarı, uygulama yazarı, inceleyici ve token-governor ajanları. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) / [`.github/workflows/security.yml`](.github/workflows/security.yml) | CI ve güvenlik taraması. |

**Proje kökünde `CLAUDE.md` yoktur.** İlgili global dosya makineye özeldir ve depoda değildir:
`/Users/karaca/.claude/CLAUDE.md`.

## 7. Git yedek kanıtı (2026-10-05)

- `main` tabanı: `5c03c06c4e800b13095c887966244b62ffd9007f`.
- Önceden yalnızca yerelde olan **58 dal ucu**, `backup/2026-10-05/local/` altında tek seferde
  (atomik) ve **force kullanılmadan** origin'e itildi. Uzaktaki sayı: **58**.
- fetch sonrası hiçbir uzakta bulunmayan yerel-ref commit'i: **0**. Stash sayısı: **0**.
- Tek annotated etiket (`kernel-runtime-substrate-s1-activated`) zaten uzakta.
- **Ayrı tutulan durum:** `git fsck` yalnızca **467 erişilemez commit nesnesi** ve bunların
  **52 ucu**nu buldu. Bunlar hiçbir dal veya worktree tarafından gösterilmiyor; en az bir zincir
  yabancı Actionplan geçmişi; genişletilmiş taramada gizli bilgiye benzeyen adaylar çıktı. Bu
  yüzden **bilerek PUBLIC Kernel deposuna yayımlanmadılar.**
- Gerçek dal ve worktree commit'leri korunmuştur. Bu sarkan nesneler adli amaçla saklanmak
  istenirse yeri **şifreli, çevrimdışı bir arşivdir; asla bu herkese açık depo değildir.**

### Formatlamadan önce: Kernel dışında kalan yerel durum

- **Actionplan yerel checkout'u** (`/Users/karaca/DEV/mimari/actionplan`) bağımsız olarak yeniden
  ölçüldü ve şunları taşıyor:
  - **46 worktree**;
  - hiçbir uzak (remote) tarafından içerilmeyen **9 yerel dal ucu**;
  - **iki stash**;
  - kök dizinde değiştirilmiş (modified) ve izlenmeyen (untracked) içerik.
- **Bu ayrı durum gizli bilgi taramasından geçirilip geri yüklemesi kanıtlanana kadar
  formatlama ENGELLİDİR.**
- Actionplan **herkese açık (public)** bir depodur; bu yüzden onu körü körüne GitHub'a itmek
  **asla önerilmez**. Önerilen yol, gözden geçirilmiş, **şifreli ve çevrimdışı** bir yedektir:
  1. Önce gizli bilgi taraması.
  2. Tüm ref'leri içeren bir Git paketi (bundle):
     `git bundle create actionplan-all.bundle --all`, ardından
     `git bundle verify actionplan-all.bundle`.
  3. Git bundle çalışma ağacındaki değiştirilmiş ve izlenmeyen baytları **içermez**; bunlar için
     ayrı bir şifreli arşiv ya da patch envanteri alınır.
  4. Formatlamadan önce bundle ve arşivden **geri yükleme denenir** ve çalıştığı görülür.
- Bu Kernel paketi o checkout'u **ne değiştirir ne de yayımlar**; bundle oluşturmaz, arşiv
  almaz. Yukarıdaki adımlar ayrı bir iştir.
- **Docker artıkları:** P23 tatbikatlarından kalan, çıkmış (exited) konteynerler ve şu dört hacim
  yerelde duruyor:
  - `mfk-p23a-d58e1597f87a-data-restored-fcc8ad00`
  - `mfk-p23b-799021b4593f-data`
  - `mfk-p23b-799021b4593f-data-standby`
  - `mfk-p23c-aec27e233b21-data`

  Bunlar **kanonik olmayan, isteğe bağlı kanıttır**. Kanonik kanıt birleşmiş PR'lar ve CI
  koşularıdır. Asla GitHub'a konmaz; saklanmak istenirse yalnızca **şifreli, çevrimdışı** dışa
  aktarılır. Bu belge silinmelerini önermez.

### Yerel envanter (yalnızca planlama tahmini)

Boyutlar: `.codex` 4.6G, `.claude` 2.7G, `.pane` 590M, `codex-claude-bridge` 161M.

Bu makinedeki sürümler **yalnızca envanterdir, hedef değildir**; depo şartıyla farklıysa depo
şartı geçerlidir:

| Araç | Bu makine | Depo şartı |
|---|---|---|
| Node | 24.6.0 | **22** |
| Python | 3.13.7 | **3.12** |
| git | 2.53.0 | — |
| npm | 11.5.1 | — |
| uv | 0.11.1 | — |
| Docker | 29.2.1 | — |
| gh | 2.93.0 | — |
| runpane | 2.4.35 | — |
| Pane | 2.4.103 | — |
| Claude Code | 2.1.289 | — |

### Worktree'ler yedek değildir

- Ham worktree dizinleri **atılabilir**dir ve **asla kanonik yedek malzemesi değildir.**
- Formatlamadan önce her worktree için: ya temizdir, ya da ref'i itilmiş veya bundle'a
  alınmıştır; commit edilmemiş baytları ayrıca arşivlenmiştir.
- Yeni makinede worktree'ler `git worktree add` ile uzak ref'lerden ya da doğrulanmış bundle
  ref'lerinden yeniden oluşturulur. Ham worktree dizini kopyalanıp gerçek kabul **edilmez**.

### Sıralı geri kurulum

Önkoşullar önce gelir:

1. Araçları kur (Git dahil). Depo şartına göre: Node 22 ve Python 3.12; ayrıca git, uv, Docker,
   gh, Pane, runpane, Claude Code.
2. Yalnızca gözden geçirilmiş özel yapılandırmayı **şifreli ortamdan** geri yükle (aşağıdaki liste).
3. SSH anahtarlarını güvenli biçimde kur veya yenile (rotate); Codex, Claude ve gh için yeniden
   oturum aç.
4. Kernel'i klonla ve ref'leri çek:
   `git clone git@github.com:metaframer-net/metaframer-kernel.git`, ardından
   `git fetch origin 'refs/heads/backup/2026-10-05/local/*:refs/remotes/origin/backup/2026-10-05/local/*'`.
   Actionplan'ı klonla ve çek: `git clone git@github.com:karacaismail/actionplan.git` — sabitlenmiş
   `f25018d937557381cf8f8dd1012c29a2e48ba374` nesnesini yalnızca beyan edildiği gibi kullan
   (ultra-fast politikanın dış bütçe referansı); yerel checkout yalnızca bulma ipucudur.
   Yalnızca yerelde kalmış Actionplan ref'leri varsa doğrulanmış şifreli bundle'dan getirilir.
5. Politika doğrulayıcısını salt okunur çalıştır:
   `python3 /Users/karaca/.local/share/codex-claude-bridge/verify_worker_policy.py --json`.
   `--enforce` yalnızca yönetilen içeriği geri yüklemek gerektiğinde kullanılır; ardından
   `--json` yeniden çalıştırılır.
6. Guardian kabulünü ve Claude oturumunun tam olarak first-party, claude.ai, Max olduğunu doğrula.
7. Worktree'leri `git worktree add` ile uzak ref'lerden veya doğrulanmış bundle ref'lerinden
   yeniden oluştur.
8. `npm ci`, `npm test`, `npm run check`.

**Özel, şifreli aktarım — asla GitHub değil**

- `/Users/karaca/.codex/AGENTS.md`, `config.toml` (gizli bilgi incelemesinden sonra), kullanıcı
  becerileri ve hafızaları.
- `/Users/karaca/.claude/CLAUDE.md`, `settings.json`, `agents` ve `skills`.
- `/Users/karaca/.pane/config.json`, `skills`, `sessions.db` ve orkestrasyon politikası/kanıtı
  (gizli bilgi incelemesinden sonra).
- `/Users/karaca/.local/share/codex-claude-bridge` kaynağı, golden dosyaları ve kanıtı;
  önbellekler ve venv yeni makinede yeniden kurulur, kopyalanmaz.
- `/Users/karaca/.agents` eklenti pazaryeri ve kişisel eklentiler.
- LaunchAgent'lar:
  - `/Users/karaca/Library/LaunchAgents/com.codex.claude-worker-policy.plist`
  - `/Users/karaca/Library/LaunchAgents/com.karaca.claude-resource-guardian.plist`
  - `/Users/karaca/Library/LaunchAgents/com.openai.codex.actionplan-changelog-collector.sweep.plist`
- Gözden geçirilmiş Git yapılandırması.

**Asla GitHub'a kopyalanmayacaklar:** auth token'ları, Claude oturum anahtarı dosyaları, API
anahtarları, ham yetenek (capability) değerleri, özel SSH anahtarları, veritabanı parolaları.
Codex, Claude ve gh yeni makinede **yeniden oturum açılarak** yetkilendirilir.

**Dış başvurular** (isteğe bağlı resmî kurulum bağlantıları; içerik kopyalanmadı):

- https://developers.openai.com/api/docs/guides/tools-skills
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/learn/docs-mcp

## 8. Bu devir paketinin kanıt notu (2026-10-05)

> Bu not yalnızca bu belge paketinin doğrulama durumunu anlatır. **Ürün hazırlığı değildir**;
> bölüm 2'deki "çalışan ürün yok" iddiası aynen geçerlidir.

- Yerel `npm test` **çıkış kodu 1** ile bitti: 1613 test geçti, sıfır doğrulama (assertion)
  hatası; ancak altı Docker testi 20. dakika ortam kontrol noktasında iptal edildi. Bu koşu
  **ortam nedeniyle geçersizdir ve asla GREEN sayılmaz.**
- `npm run check` **GREEN**.
- Altı hedefli belge kontrolü **GREEN**: `tests/repository-boundary.test.mjs`,
  `tests/control-plane-bootstrap.test.mjs`, `tests/kernel-roadmap-v1-current-truth.test.mjs`,
  `tests/kernel-versioning-changelog.test.mjs`, `tests/kernel-license-boundary-p24e1.test.mjs`,
  `tests/kernel-security-dependency-secret-scan-p21g.test.mjs`.
- Birleştirmeden (merge) önce CI tam test takımını yine de koşmalıdır.
