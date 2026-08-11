# P01 mimari yön kararı — insan karar paketi (aday)

**Durum: KARAR: VERİLMEDİ. Bu belge bir öneridir, bir karar değildir.**

Bu belge tek bir soruyu senin önüne koyar. Cevabı sen verirsin. Ne ben, ne bir başka ajan, ne de
bir makine kontrolü bu soruyu senin yerine cevaplayabilir. Belgenin makine tarafında okunan hâli
`planning/p01-architecture-decision-candidate.json`, ve orada karar alanı `HUMAN_DECISION_REQUIRED`
yazıyor; imza, imzalayan ve tarih alanları boş. Bir kontrol aracı bu alanların boş kaldığını her
çalıştırmada denetliyor.

---

## 1. Bugün elimizde ne var

Bunu programcı olmayan biri için sade anlatayım.

Şu an iki ayrı yarım parça var ve **birbirlerine hiç dokunmuyorlar.**

**Birinci yarım — JavaScript (Node) tarafı.** Yedi küçük dosya. İçlerinde "kiracı kimliği nedir",
"bir komut nedir", "bir işin sonucu nasıl temsil edilir" gibi temel kavramların tanımları var. Çok
titiz yazılmışlar ve testleri var. Ama hiçbiri bir iş *yapmıyor*: veritabanına bağlanmıyorlar, bir
şey kaydetmiyorlar. Kendi yorumlarında bile "ben bir sınır değilim, sadece bir sınırın nasıl
görünmesi gerektiğini söylüyorum" yazıyor.

**İkinci yarım — Python tarafı.** Gerçekten çalışan bir veritabanı temeli. Kiracıların birbirinin
verisini görememesi, denetim kaydının silinememesi, güvenli mesaj kuyruğu — bunlar gerçek ve
sınanmış.

**Aradaki bağ: yok.** Bir taraf diğerini çağırmıyor. Tek bir çağrı bile yok.

Bunlara ek olarak, olmayan üç şey var: dış dünyaya açılan bir kapı (Delivery), veriye erişen ara
katman (Adapters) ve bir SDK. Hiçbiri yazılmadı. FastAPI de kurulu değil; bu depoda hiç yok.

## 2. Karar niye gerekli

Anlamın hangi tarafta tanımlanacağı belli değil. "Bir sipariş ne zaman geçerlidir", "kim neye
izinlidir", "bir yazma işlemi ne zaman tamamlanmış sayılır" — bu cümleler hangi dilde yazılacak?

Bu soru açık kaldığı sürece sonraki her adım rehin. Her yeni parça için "bu hangi tarafta olacak"
sorusu yeniden sorulur ve her deneyin maliyeti iki katına çıkar. Sıradaki faz (P02) bu yüzden
başlayamıyor.

---

## 3. Önerilen yön — karara sunulan tek cümle

> Önerilen yön: MetaFramer’ın kanonik kernel dili Python; FastAPI yalnız dış API/Delivery kapısı; mevcut Node kodu geçiş boyunca dondurulmuş uyumluluk referansı. Kalıcı çift-runtime yok.

Aynı cümlenin gündelik Türkçesi:

- **Ana dil Python olsun.** İş kuralları ile veritabanı işlemi aynı yerde olsun, arada ağ olmasın.
- **FastAPI sadece kapı olsun.** Dış dünyadan gelen isteği karşılar, içeriye verir, cevabı geri
  götürür. Hiçbir kural, hiçbir karar, hiçbir iş mantığı onun içinde yaşamaz. Bunun dürüst tek
  testi şu: *FastAPI'yi sil; çekirdek testleri hâlâ geçiyor mu?* Geçmiyorsa koşul ihlal edilmiştir.
- **Node kodu silinmesin, dondurulsun.** Yazma yetkisi sıfır olur. Görevi tek şey olur: yeni tarafın
  aynı cevabı verdiğini kanıtlamak için karşılaştırma referansı olmak. Bağımsız bir doğrulayıcı
  "iki taraf aynı" diyene kadar olduğu yerde durur.
- **Kalıcı çift-runtime yok.** İki ayrı sistemin ikisi de kalıcı olarak yazamaz. Yazan tek taraf
  olur.

## 4. Bu öneriyi kabul etmek ne değiştirir

Kabul edersen — yani imzalarsan:

- Bundan sonra kod yazan herkes, insan ya da ajan, **hangi dilde ve hangi halkada** yazacağını
  bilir. Bugün bu belli değil.
- Kanonik dil bir kez sabitlenir; her pakette yeniden tartışılmaz.
- Geçiş **bu deponun içinde**, aşama aşama yapılır: önce iki tarafın da geçmesi gereken ortak
  sınav dosyaları yazılır, sonra Python tarafı o sınavı geçer, sonra bağımsız biri "gerçekten aynı"
  der, en sonda devir olur. Devir aşaması imzasız başlamaz.
- P02'nin önündeki kapı açılır.

**Ne kazanılmaz:** yeni bir ürün, yeni bir ekran, yeni bir özellik. Hiçbiri. Bu kararın ürünü
mimari güvendir — bir sonraki adımın hangi zemine basacağını bilmek. Yetenek değişimi: **yok.**

## 5. Reddetmek ne değiştirir

Reddedersen ya da başka bir seçeneği tercih edersen:

- Hiçbir şey bozulmaz. Bugünkü durum aynen devam eder; bu paket hiçbir dosyayı değiştirmedi.
- Öneri kaydedilmiş olarak kalır ve seçenek kütüğü açık kalır.
- İki açık karar kaydı (`HD-RUNTIME-ADR` ve `HD-TOPOLOGY-EXTRACTION-ADR`) açık kalmaya devam eder,
  ve P02 beklemeye devam eder.

Yani reddetmenin bedeli "kaybedilen iş" değil; bedeli, aynı sorunun sonraki her pakette yeniden
açılmasıdır.

## 6. Bu belge neyi yetkilendirmiyor

Bunları açıkça yazıyorum, çünkü bir karar paketinin en tehlikeli yanı, sessizce karar yerine
geçmesidir:

- **Hiçbir faz makbuzu üretilmedi.** `RCPT-01` yok. P01 çıkış kapısı açık.
- **Hiçbir imza yok** ve hiçbir imza taklit edilmedi.
- **Hiçbir boşluk (gap) kapanmadı.**
- **Kaynak taşıma/bölme/çıkarma yetkisi verilmedi.** `sourceExtraction=false` ve bu değer, deponun
  kendi durum dosyasından okunarak makine tarafından karşılaştırılıyor.
- **FastAPI kurulmadı, sevk edilmedi**, ve bir kernel/SDK/ürün yeteneği sayılmadı.
- **Hiçbir hazırlık, sürüm, dağıtım veya canlı bayrağı oynamadı.** Hepsi `false`.
- **`src` ve `db` altındaki tek bir satır bile değişmedi.** Mevcut yedi Node dosyasının parmak izi
  bu pakete kaydedildi ve her kontrol çalıştırmasında diskteki hâliyle karşılaştırılıyor.

---

## 7. Üç seçenek, aynı ölçütlerle

| | **S1 — Node ana dil** | **S2 — Python ana dil (önerilen)** | **S3 — kalıcı iki dil** |
|---|---|---|---|
| **Güvenlik** | Kiracı kimliği iki program arasında taşınmak zorunda. Bu kapıyı, kapıyı bekleyecek bekçiden (P04) bir faz önce açar. | Kimlik hiç taşınmaz; karar da işlem de aynı yerde. Riski farklı: FastAPI'nin sessizce merkeze yerleşmesi. Testi basit ve kesin. | En kötüsü: iki ayrı yazma yolu, iki ayrı kimlik yolu. |
| **Uyumluluk** | Bugünkü Node kodu aynen kalır. Daha önce imzalanmış arka uç yığını kararıyla çelişir. | Zaten çalışan Python temeliyle ve o kararla uyumlu. Bedeli Node tarafına düşer. | Görünüşte en uyumlu; gerçekte geri dönüşü en hızlı kapanan. |
| **Geçiş** | Taşıma yok; asıl iş iki taraf arasındaki sözleşmeyi yazmak. | Depo içinde, aşamalı: ortak sınav dosyaları → eşitlik → bağımsız doğrulama → devir. | Geçiş yok; bu bir avantaj değil, sorunun kendisi. |
| **Tarih** | Korunur. | Korunur; taşıma yok. | Korunur, ama karara etkisi yok. |
| **Kod geri alma** | Temiz. | Devire kadar temiz: yeni taraf eklemeli, Node dokunulmamış. | Zamanla bozulur; kasten sürdürülen bir ayrımın tek adımlık geri dönüşü yoktur. |
| **Veri geri alma** | **Tatbik edilmedi.** Veritabanı geri indirme yolu veri açısından yıkıcı. | **Tatbik edilmedi, açıkça beklemede.** Devirden önce yedekten geri yükleme provası şart. | En kötüsü: iki yazıcı, ortak bir geri dönüş noktasına varmadan ayrışabilir. |
| **İşletme maliyeti** | İki dil kalıcı: iki araç zinciri, iki bağımlılık kümesi, iki güvenlik akışı. | En düşük: tek araç zinciri, tek bağımlılık kümesi. Node yönetişim araçları zaten yerinde kalır. | İkisinin toplamı, kalıcı olarak, tek bir bakım sahibine. |
| **Sonuç** | KOŞULLU | KOŞULLU | **RET** |

S3 hakkında bir dürüstlük notu: insanların bu seçenekle kastettiği savunulabilir düzen — *bir taraf
karar verir ve yazar, öbür taraf üretir ve gösterir* — aslında üçüncü bir seçenek değildir. O, S1
veya S2'nin üstüne bir arayüz eklenmiş hâlidir. Bu yüzden imzalanan belgede ana dilin **adı**
yazmak zorunda.

## 8. Önerilen yön kabul edilirse: koşullar ve durdurma sebepleri

Öneri koşulsuz değil. Altı koşulu var, ve bunlardan biri sağlanamazsa yön yanlıştır:

1. FastAPI, iç halkalara (Domain ve Application) hiçbir şekilde giremez — bu bir görgü kuralı değil,
   makine tarafından denetlenen bir kural olur.
2. FastAPI silindiğinde çekirdek testleri değişmeden geçer. Gerçekten çalıştırılır, iddia edilmez.
3. Devirden önce, iki tarafın da geçtiği sürümlenmiş ortak sınav dosyaları vardır.
4. Node referansı, bağımsız bir doğrulayıcı eşitliği onaylayana dek olduğu gibi korunur.
5. Veri geri alma provası, kod geri almadan ayrı olarak, devirden önce kayda geçer.
6. Belirlenimci (deterministic) davranış ve yapay zekâ kapalıyken doğru çalışma korunur ve ölçülür.

**Durdurma / yön değiştirme sebepleri:**

- **Eşitlik bozulursa:** iki taraf bir sınav dosyasında farklı cevap verirse, geçiş orada durur.
- **Güvenlik sınırı ihlal edilirse:** bir kiracı/yetki iddiasının bir çalışma zamanı sınırını
  geçtiği görülürse, hemen durulur. Bu, önerinin var oluş sebebidir; yamalanacak bir kusur değil.
- **Ölçülen maliyet kabul edilebilir sınırı aşarsa:** tahmin değil, ölçüm. Ölçüm karar sahibine geri
  götürülür.
- **Belirlenimcilik ya da yapay zekâ kapalı doğruluk korunamazsa:** durulur. Bunlar çekirdeğin
  özellikleridir, bir çalışma zamanının değil.

Para birimi cinsinden hiçbir tahmin bu belgede yok ve olmayacak — elimizdeki kanıtta hiçbir
ölçülmüş rakam bulunmuyor, uydurulan bir rakam ise sonraki okuyucuya ölçülmüş gibi görünür.

## 9. Bu öneri neye dayanıyor

Altı bağımsız, salt-okunur inceleme yapıldı; her biri kendi başına çalıştı ve hiçbiri dosya
yazmadı. Altısının da yolu, dosya boyutu ve parmak izi karar belgesine kaydedildi; kontrol aracı
bunları her çalıştırmada doğruluyor. Dosyalar erişilemez durumdaysa araç "yok" der — asla
"doğrulandı" demez.

1. Node ana dil incelemesi — KOŞULLU
2. Python ana dil incelemesi — KOŞULLU
3. Kalıcı iki dil incelemesi — kendi sonuç etiketi KOŞULLU, ama içeriği iki eşit yazma yolunu
   reddediyor. Bu fark belgede saklanmadı, olduğu gibi yazıldı.
4. Güvenlik karşılaştırması — KOŞULLU; S2'yi tercih ediyor
5. Geçiş ve işletme karşılaştırması — KOŞULLU; S2'nin yaşam döngüsü maliyeti en düşük
6. Faz zinciri kilitlenme denetimi — RET; bu paketin sınırını da o çizdi: makbuz üretmeyen,
   imza gerektirmeyen hazırlık işi

Ayrıca dört yetki dosyası (faz zinciri, sahiplik listesi, bağımlılık listesi, boşluk matrisi)
parmak iziyle sabitlendi. P01'in altı boşluğu ve beş kapanış bağı bu dosyalardan yeniden türetilip
karşılaştırılıyor; belge onlardan sessizce ayrışamaz.

---

## 10. İnsan karar bloğu

Bu bloğu **yalnızca yetkili insan** doldurur. Hiçbir ajan, hiçbir araç, hiçbir otomatik adım bu
alanları dolduramaz; boş kalmaları makine tarafından denetleniyor.

```text
KARAR: VERİLMEDİ
Durum:            HENÜZ İMZALANMADI
Seçilen seçenek:  (boş)
Karar veren:      (boş)
İmza:             (boş)
Tarih:            (boş)
Gerekçe:          (boş)
```

İlgili açık kayıtlar — hepsi açık durumda:

- `HD-RUNTIME-ADR` (KG-002) — kanonik dil ve halka sahipliği
- `HD-TOPOLOGY-EXTRACTION-ADR` (KG-003) — kanonik sahiplik ve kaynak çıkarma sınırı
- `HD-01-1` — kapsam ve risk iştahı
- `HD-01-2` — kernel/SDK/uygulama sınırında kapsam dışı bırakılacaklar

Bu blok doldurulana kadar: P01 çıkış kapısı açıktır, `RCPT-01` yoktur, hiçbir boşluk kapanmamıştır
ve hiçbir bayrak oynamamıştır. Kalem sende.
