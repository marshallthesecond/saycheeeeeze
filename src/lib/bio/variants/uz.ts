// O'zbekcha variantlar. Yangi variantlarni massiv OXIRIGA qo'shing.
//
// Qoidalar: 2-3 gap, ~280 belgidan oshmasin, ism + "fotograf" + "Toshkent".
// Quruq va o'ziga ishongan ohang, qo'polliksiz, emoji va undov belgisisiz.
//
// Bu inglizcha variantlarning tarjimasi EMAS — kinoya so'zma-so'z tarjima
// qilinmaydi. Soni en / ru bilan bir xil bo'lsin (../pool.ts ga qarang).

export const bios: readonly string[] = [
  "Mening ismim Shamshod, Toshkentda fotograf bo'lib ishlayman. Va bu ishni jonga tegadigan darajada yaxshi bajaraman. Siz g'oyani va to'rt marta almashtirilgan kiyimni olib keling — qolganini o'zim uddalayman.",

  "Shamshod. Fotograf. Toshkent. Odamlarga qimmat kamerani qarataman va ular o'zlari haqida aytadigan versiyani ko'rsataman. His-tuyg'u — qo'shimcha to'lovsiz.",

  "Ismim Shamshod, Toshkentda suratga olaman. Rasman — tasavvuringizni jonlantiraman. Norasman — meni unutguningizcha yoningizda turaman. Eng yaxshi kadr aynan o'shanda tushadi.",

  "Shamshod, fotograf, Toshkent. Sun'iy tabassum ham, o'ynab ko'rsatilgan tabiiylik ham yo'q. Faqat haqiqiysi — va u oson ko'rinadi. Oson emas, lekin bu mening muammoyim.",

  "Men Shamshodman. Toshkentda o'zini suratga tushmaydigan deb hisoblaydigan odamlarni suratga olaman. Hisob hozircha mening foydamga.",

  "Shamshod, Toshkentdagi fotograf. Tavsifda lahzalarni suratga olaman deb yozilgan. Aslida esa sizni chiroyli chiqishingizga ishontiraman va yigirma daqiqada buni isbotlayman.",

  "Ismim Shamshod, Toshkentda fotografman. Bu haqda kamtarona gapiradi, deyishadi. Bu yolg'on, lekin suratlar yaxshi, shuning uchun hech kim bahslashmaydi.",

  "Shamshod, Toshkent. Oldimga hayajonlanib kelishadi, yangi profil surati bilan ketishadi. Hayajon — jarayonning bir qismi: butun ishim siz o'ynashni to'xtatgan o'n soniyaga qurilgan.",

  "Mening ismim Shamshod, Toshkentda fotografman. Ishimning yarmi — kattalarga qo'llarini qayerga qo'yishni tushuntirish. Bu qismi hech kimga yoqmaydi. Natija hammaga yoqadi.",

  "Men Shamshod, Toshkentdagi fotograf. To'rt yuz kadr olaman, o'ttiztasini ko'rsataman. Qolgan uch yuz yetmishtasi — o'sha o'ttizta aynan shunday chiqishi uchun kerak.",

  "Shamshod, Toshkentda odamlarni suratga olaman. Ko'zim o'tkir, vaqtni yaxshi ilg'ayman va oyna oldida mashq qilgan pozangizga umuman qiziqmayman. Yaxshirog'ini topamiz.",

  "Men Shamshodman. Fotograf. Toshkent. Kun bo'yi shu shahar bo'ylab yorug'lik ortidan yuraman va u kechqurun soat yettida qayerga tushishini deyarli hech qachon adashmayman.",

  "Ismim Shamshod, Toshkentda suratga olaman. G'oyani siz olib keling — uni xayolingizdagidek ko'rinishga keltirish mening zimmamda.",

  "Shamshod, Toshkentdagi fotograf. Kadrlar samimiy chiqadi, deyishadi. Bu omad emas. Bu — suratga tushish sizga zerikarli bo'lguncha sabr bilan kutishim.",

  "Men Shamshod, Toshkentda fotografman. Muddatlarga ham, ob-havoga ham, chap tomonim yomonroq degan ishonchingizga ham xotirjam qarayman. Yomonroq emas.",

  "Shamshod — Toshkent, kamera, o'rtacha o'ziga ishonch. His-tuyg'uli va samimiy kadrlar yarataman. Dabdabasiz aytganda: ularda siz omadli kuningizdagi o'zingizga o'xshaysiz.",

  "Mening ismim Shamshod, fotograf, Toshkent. Texnikam uchun chaqirishadi, zatvordan bir soniya oldin kuldirganim uchun qolishadi.",

  "Men Shamshod, Toshkentda suratga olaman. Hech qachon o'zingizni tabiiy tuting demaganman va demayman ham — fotografiya tarixida bu hech kimga yordam bermagan.",

  "Shamshod. Toshkentdagi fotograf, ba'zan yaxshiroq rakurs uchun biror narsaning tepasidan topiladi. Kadrlar bunga arziydi. Tizzalarim rozi emas.",

  "Men Shamshod, Toshkentda fotografman. Mijozlar odatda kutganidan yaxshi chiqibdi, deyishadi. Buni maqtov deb qabul qilishga qaror qildim.",

  "Shamshod, fotograf, Toshkent. Sizni boshqa odamga aylantirmayman. Shunchaki sizga allaqachon yarashib turgan yorug'likni topaman va unga xalaqit bermayman.",

  "Ismim Shamshod. Toshkentda odamlarni suratga olaman va kiyimingiz haqida fikrim bor. Eshitish shart emas. Odatda eshitishadi.",

  "Men Shamshod — Toshkentdagi fotograf. Bir soat vaqt va durustroq deraza bering, keyingi uch yilga yetadigan surat beraman.",

  "Shamshod, Toshkentda suratga olaman. Tasavvur, his-tuyg'u, samimiylik — bu so'zlar har ikkinchi tavsifda bor. Farqi shuki, men isbotini ko'rsataman.",

  "Men Shamshod, fotograf, Toshkent. Erta kelaman, yorug'lik qayerga tushishini bilaman va yomon kadrni hech qachon ob-havoga to'nkamaganman. Ikki martadan tashqari.",

  "Shamshod, Toshkentdagi fotograf. Oddiy seshanbani devorga osiladigan suratga aylantiraman. G'alati kasb. Menga juda yaxshi to'g'ri keladi.",

  "Mening ismim Shamshod, Toshkentda fotografman. Mutaxassisligim — suratga tushishni yomon ko'raman deydiganlar. Ular doim fikridan qaytadi. Endi qiziq ham emas.",

  "Men Shamshodman. Toshkent. Kamera. Poza kerak emas, o'ynash kerak emas, qorin tortish ham kerak emas — shunchaki turing, qiyin qismini o'zim bajaraman.",

  "Shamshod, Toshkentdagi fotograf. Ishning yarmi — texnika. Ikkinchi yarmi — qo'lida kamera borligini unuttiradigan odam bo'lish. Ikkinchisi menda yaxshiroq chiqadi.",

  "Men Shamshod, Toshkentda odamlarni suratga olaman. Birinchi o'n daqiqa qisilib, uzr so'rab turasiz, qolgan vaqt esa nega bunchalik kutganingizni o'ylaysiz. Odatdagi jadval.",
];