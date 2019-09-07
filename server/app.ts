import * as express from "express";
import * as bodyParser from "body-parser";
import axios from "axios";
import * as qs from "qs";
import * as session from "express-session";
import * as cheerio from "cheerio";
import * as morgan from "morgan";
import * as cors from "cors";
import * as HttpStatus from "http-status-codes";
import { Train } from "../common/train";
import { stations } from "../common/station";
import * as moment from "moment";

const commonHeader = {
    Host: "www.letskorail.com",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
    "Accept-Encoding": "gzip, deflate, br",
    "Content-Type": "application/x-www-form-urlencoded",
    Connection: "keep-alive"
};

const loginHeader = {
    Host: "www.letskorail.com",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://www.letskorail.com/korail/com/login.do",
    "Content-Type": "application/x-www-form-urlencoded",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1"
};

const reserveHeader = {
    ...commonHeader,
    Referer: "http://www.letskorail.com/ebizprd/EbizPrdTicketPr21111_i1.do"
};

axios.defaults.headers = commonHeader;

const app = express();

app.use(morgan("tiny"));
app.use(cors({ credentials: true, origin: true }));

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.set("trust proxy", 1); // trust first proxy

app.use(
    session({
        secret: "keyboard cat",
        resave: false,
        saveUninitialized: true,
        cookie: { httpOnly: false }
    })
);

app.post("/login", (req, res, next) => {
    axios
        .post(
            "https://www.letskorail.com/korail/com/loginAction.do",
            qs.stringify({
                selInputFlg: 2, //로그인 타입 (회원번호==2, 전화번호==4)
                UserId: req.body.userNumber,
                UserPwd: req.body.userPassword,
                radIngrDvCd: 2,
                hidMemberFlg: 1,
                txtDv: 2
            }),
            {
                headers: loginHeader
            }
        )
        .then(response => {
            if (
                response.data &&
                response.data.includes(
                    "비밀번호 5회 오류시 로그인할 수 없습니다"
                )
            ) {
                res.status(HttpStatus.BAD_REQUEST).send(
                    "invalid id or password"
                );
            } else if (
                response.data &&
                response.data.includes("ret_url") &&
                response.data.includes("strWebPwdCphdAt") &&
                response.headers &&
                response.headers["set-cookie"]
            ) {
                // 로그인 성공
                // 쿠키값 세션에 저장
                if (
                    response.headers &&
                    response.headers["set-cookie"] &&
                    response.headers["set-cookie"].length > 0
                ) {
                    console.log(response.headers["set-cookie"]);
                    const setCookieHeader = response.headers["set-cookie"].find(
                        item => item.includes("JSESSIONID")
                    );
                    const sessionKey = setCookieHeader
                        .split(";")[0]
                        .split("JSESSIONID=")[1];

                    console.log(sessionKey);
                    req.session!.JSESSIONID = sessionKey;
                    req.session!.expires = false;
                }

                res.status(HttpStatus.OK).send("success");
            } else {
                res.status(HttpStatus.BAD_REQUEST).send(
                    "invalid id or password"
                );
            }
        })
        .catch(next);
});

app.get("/trainList", (req, res, next) => {
    const startStation = req.query.startStation;
    const destStation = req.query.destStation;
    // YYYYMMDD
    const requestDate = moment(req.query.requestDate, "YYYYMMDD");
    // HH
    const requestTime = req.query.requestTime;

    const startStationText = stations.find(s => s.value === startStation)!.text;
    const destStattionText = stations.find(s => s.value === destStation)!.text;

    const lookupParam = {
        selGoTrain: "05",
        txtPsgFlg_1: 1, // n: 어른 수
        txtPsgFlg_2: 0, // 장애 만4세~12세 어린이
        txtPsgFlg_3: 0, // 만 65세 이상
        txtPsgFlg_4: 0, // 장애1~3급
        txtPsgFlg_5: 0, // 장애4~6급
        txtSeatAttCd_3: "000", // 좌석종류 기본:000, 1인석:011, 창가좌석:012, 내측좌석:013
        txtSeatAttCd_2: "000", // 좌석반향 전체:000, 순방향:009, 역방향:010
        txtSeatAttCd_4: "015", // 세부적인 특징: 기본:015, 노트북 031, 유아동반:019
        selGoTrainRa: "05", // 열차 종류. 전체:05, KTX_SRT:00, ITX_청춘:09, 새마을호/ITX-새마을:08, 무궁화:02, 통근열차:03
        radJobId: 1, // 직통:1, 나머진(환승, 왕복) 귀찮다. 안한다.
        txtGoStart: startStationText,
        txtGoEnd: destStattionText,
        txtGoStartCode: "",
        txtGoEndCode: "",
        selGoYear: requestDate.format("YYYY"),
        selGoMonth: requestDate.format("MM"), // MM형식으로 맞춰야함
        selGoDay: requestDate.format("DD"),
        selGoHour: requestTime,
        txtGoHour: "",
        selGoSeat1: "015",
        txtPsgCnt1: 1, // 전체 사람수 (휠체어 좌석 선택시 전체사람수 - 장애인수)
        txtPsgCnt2: 0, // 장애인 사람
        txtGoPage: 1, // 조회페이지는 1, 예약페이지는2 ??
        txtGoAbrdDt: requestDate.format("YYYYMMDD"),
        checkStnNm: "Y", // ???
        txtMenuId: 11 //??
    };

    axios
        .post(
            "https://www.letskorail.com/ebizprd/EbizPrdTicketPr21111_i1.do",
            qs.stringify(lookupParam)
        )
        .then(response => {
            const $ = cheerio.load(response.data);
            const trainList: Train[] = [];
            $("#tableResult > tbody > tr").each((trIndex, trElem) => {
                const tdElem = $(trElem).find("td");
                const trainIdText = $(tdElem[1])
                    .text()
                    .trim();
                const trainIdIndex = trainIdText.match(/[0-9]/)!.index;
                const trainId = trainIdText.slice(trainIdIndex);
                const startTimeText = $(tdElem[2])
                    .text()
                    .trim();
                const startTimeIndex = startTimeText.match(/[0-9]/)!.index;
                const startTime = startTimeText.slice(startTimeIndex);
                const destTimeText = $(tdElem[3])
                    .text()
                    .trim();
                const destTimeIndex = destTimeText.match(/[0-9]/)!.index;
                const destTime = destTimeText.slice(destTimeIndex);
                const duration = $(tdElem[13])
                    .text()
                    .trim();
                trainList.push({
                    startTime,
                    destTime,
                    duration,
                    trainId
                });
            });
            res.status(HttpStatus.OK).send(trainList);
        })
        .catch(next);
});

app.post("/checkLogin", (req, res) => {
    if (req.session!.JSESSIONID) {
        res.status(HttpStatus.OK).send("logged in");
    } else {
        res.status(HttpStatus.UNAUTHORIZED).send("not logged in");
    }
});

app.post("/logout", (req, res, next) => {
    req.session!.destroy(err => {
        if (err) {
            next(err);
        } else {
            res.status(HttpStatus.OK).send("loggout");
        }
    });
});

app.post("/reserveTrain", async (req, res, next) => {
    function requestReservation(params: {
        date: string;
        startTime: string;
        trainId: string;
        startPoint: string;
        destPoint: string;
        seatType: string;
        childCount: number;
        adultCount: number;
    }) {
        const startStationText = stations.find(
            s => s.value === params.startPoint
        )!.text;
        const destStattionText = stations.find(
            s => s.value === params.destPoint
        )!.text;
        const reserveParam = {
            selGoTrain: "05",
            txtPsgFlg_1: 1, // n: 어른 수
            txtPsgFlg_2: 0, // 장애 만4세~12세 어린이
            txtPsgFlg_3: 0, // 만 65세 이상
            txtPsgFlg_4: 0, // 장애1~3급
            txtPsgFlg_5: 0, // 장애4~6급
            txtSeatAttCd_3: "000", // 좌석종류 기본:000, 1인석:011, 창가좌석:012, 내측좌석:013
            txtSeatAttCd_2: "000", // 좌석반향 전체:000, 순방향:009, 역방향:010
            txtSeatAttCd_4: "015", // 세부적인 특징: 기본:015, 노트북 031, 유아동반:019
            selGoTrainRa: "05", // 열차 종류. 전체:05, KTX_SRT:00, ITX_청춘:09, 새마을호/ITX-새마을:08, 무궁화:02, 통근열차:03
            radJobId: 1, // 직통:1, 나머진(환승, 왕복) 귀찮다. 안한다.
            txtGoStart: startStationText,
            txtGoEnd: destStattionText,
            selGoYear: moment(params.date).format("YYYY"),
            selGoMonth: moment(params.date).format("MM"),
            selGoDay: moment(params.date).format("DD"),
            selGoSeat1: "015", // 세부적인 특징: 기본:015, 노트북 031, 유아동반:019
            selGoSeat2: "015", // 세부적인 특징: 기본:015, 노트북 031, 유아동반:019
            txtPsgCnt1: 0, // 카운트가 이상하지만.. 고정인듯
            txtPsgCnt2: 0, // 카운트가 이상하지만.. 고정인듯
            txtGoPage: 1, // ?? 고정인듯
            txtGoAbrdDt: moment(params.date).format("YYYYMMDD"), // 예약 날짜
            checkStnNm: "Y", // ?? 고정인듯
            chkInitFlg: "Y", // ?? 고정하면 되는 듯
            txtMenuId: 11, // ?? 고정하면 되는 듯
            ra: 1, // 할인카드 사용 여. 고정
            txtSeatAttCd1: "000", // ??
            txtSeatAttCd2: "000", // 좌석반향 전체:000, 순방향:009, 역방향:010
            txtSeatAttCd3: "000", // 좌석종류 기본:000, 1인석:011, 창가좌석:012, 내측좌석:013
            txtSeatAttCd4: "015", // 세부적인 특징: 기본:015, 노트북 031, 유아동반:019
            txtSeatAttCd5: "000", // ?? 고정인듯
            strChkCpn: "N", // 쿠폰사용 여부 체크 (default : N)
            txtTotPsgCnt: "1", // 사람 수
            txtSrcarCnt: "0", // ?? 고정인듯
            txtSrcarCnt1: "0", // ?? 고정인듯
            hidRsvTpCd: "03", // 일반 예약:03, 단체예약:09
            txtPsgTpCd1: "1", // ?? 고정인듯
            txtPsgTpCd2: "3", // ?? 고정인듯
            txtPsgTpCd3: "1", // ?? 고정인듯
            txtPsgTpCd5: "1", // ?? 고정인듯
            txtPsgTpCd7: "1", // ?? 고정인듯
            txtPsgTpCd8: "1", // ?? 고정인듯
            txtPsgTpCd9: "1", // ?? 고정인듯
            txtDiscKndCd1: "000", // ?? 고정인듯
            txtDiscKndCd2: "000", // ?? 고정인듯
            txtDiscKndCd3: "111", // ?? 고정인듯
            txtDiscKndCd5: "131", // ?? 고정인듯
            txtDiscKndCd7: "112", // ?? 고정인듯
            txtCompaCnt1: params.adultCount, // 일반 어른
            txtCompaCnt2: params.childCount, // 일반 어린이
            txtCompaCnt3: 0, // 장애1-3 어른
            txtCompaCnt4: 0, // 장애1-3 어린이
            txtCompaCnt5: 0, // 경로 어른
            txtCompaCnt6: 0, // 청소년
            txtCompaCnt7: 0, // 장애4-6 어
            txtJobId: "1101", // 개인예약:'1101', 에약대기:'1102', SEATMAP예약:'1103'
            txtJrnyCnt: "1", // 여정 수
            txtPsrmClCd1: params.seatType === "normal" ? 1 : 2, // 일반실:1, 특실: ?
            txtJrnySqno1: "001", // ?? 고정인듯
            txtJrnyTpCd1: "11", // 편도:11, 환승:14
            txtDptDt1: moment(params.date).format("YYYYMMDD"), // 이렇게 하면 새벽기차는 날짜가 달라질텐데...
            txtDptRsStnCd1: params.startPoint, // 출발역 코드
            txtDptRsStnCdNm1: startStationText, // 출발역 이름
            txtDptTm1: params.startTime, // 출발시간
            txtArvRsStnCd1: params.destPoint, // 도착역 코드
            txtArvRsStnCdNm1: destStattionText, // 도착역 이름
            txtArvTm1: "**", // 도착시간
            txtTrnNo1: params.trainId.padStart(5, "0"), // 열차 번호 (열차관련 정보)
            txtRunDt1: moment(params.date).format("YYYYMMDD"), // 날짜
            txtTrnClsfCd1: "00", // ?? 고정인듯
            txtTrnGpCd1: "100", // 고정하면될듯..
            txtChgFlg1: "N" // ?? 고정인듯
        };
        return axios.post(
            "https://www.letskorail.com/ebizprd/EbizPrdTicketPr12111_i1.do",
            qs.stringify(reserveParam),
            {
                headers: {
                    ...reserveHeader,
                    Cookie: "JSESSIONID=" + req.session!.JSESSIONID + ";"
                }
            }
        );
    }

    if (!req.session!.JSESSIONID) {
        res.status(HttpStatus.UNAUTHORIZED).send();
        return;
    }
    const date = req.body.date;
    const startTime = req.body.startTime;
    const trainId = req.body.trainId;
    const startPoint = req.body.startPoint;
    const destPoint = req.body.destPoint;
    const seatType = req.body.seatType;
    const childCount = parseInt(req.body.childCount, 10);
    const adultCount = parseInt(req.body.adultCount, 10);

    const dateText = `${moment(date, "YYYY-MM-DD (hhh)").format("YYYYMMDD")}`;
    const startTimeText = `${moment(startTime, "HH:mm").format("HHmm")}00`;
    try {
        const requestReservationResponse = await requestReservation({
            date: dateText,
            startTime: startTimeText,
            trainId,
            startPoint,
            destPoint,
            seatType,
            childCount,
            adultCount
        });
        console.log(requestReservationResponse.data);
        if (requestReservationResponse.data.includes("/login.do")) {
            res.status(HttpStatus.UNAUTHORIZED).send("invalid token");
            return;
        }
        if (requestReservationResponse.data.includes("잔여석없음")) {
            res.status(HttpStatus.OK).send("full");
        } else if (
            requestReservationResponse.data.includes("열차구간정보오류")
        ) {
            res.status(HttpStatus.OK).send("잘못된 열차 설정");
        } else if (
            requestReservationResponse.data.includes(
                "20분 이내 열차는 예약하실 수 없습니다"
            )
        ) {
            res.status(HttpStatus.OK).send("잘못된 시간 설정");
        } else if (
            requestReservationResponse.data.includes(
                "20분 이내 결제하셔야 승차권 구매가 완료됩니다"
            )
        ) {
            res.status(HttpStatus.OK).send("ok");
        } else if (requestReservationResponse.data.includes("ERROR")) {
            res.status(HttpStatus.OK).send("ERROR");
        } else {
            next();
        }
    } catch (e) {
        next(e);
    }
});

app.use((err, req, res, next) => {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("internal server error");
});

app.listen(3000, function() {
    console.log("Example app listening on port 3000!");
});
